"use strict"
let HTTP = require('http');
let HTTPS = require("https");
let mime = require("mime-types");
let mysql = require("mysql");
let fetch = require("node-fetch");
let yaml = require('js-yaml');
let fs = require('fs');
let formidable = require('formidable');
let path = require('path');
let util = require('util');
let sessions = require("client-sessions");
let auth = require('./auth.js');
let templating = require('./templating.js');
const WebSocket = require('ws');
const SecureWebSocket = require('wss');

var properties = read_yaml();

var requestSessionHandler = sessions({
  cookieName: "session",
  secret: properties.cookie_secret || "there are no wolves on fenris",
  duration: 24 * 60 * 60 * 1000,
  activeDuration: 1000 * 60 * 5
});

//database connection, global because passing it around seems pointless
var con;

//daybreak API ID
var serviceID = "s:jtwebtech"

//websocket server to send notifications to clients
var wss;
var notification_clients = [];

//start the HTTP server
start_server(properties.http_port, properties.server_ip);
//connect to the mySQL server using the credentials from the properties file
connect_db(properties);
//set up promisified version of the query method so we can await it
const query = util.promisify(con.query).bind(con);
auth.setQueryMethod(query);

startup();
//subscribe to the exp gained events from the API
request_events();

var pageMap = {
  "/":"index.html",
  "/favicon.ico":"favicon.ico", //we have to serve this locally because deybreak's cdn is weird
  "/fanart":"fanart.html",
  "/login":"login.html",
  "/test":"test.txt",
  "/style.css":"style.css",
  "/fanart.css":"fanart.css",
  "/loginstyle.css":"loginstyle.css",
  "/VSlogo.svg":"aliens.svg",
  "/TRlogo.svg":"sword.svg",
  "/NClogo.svg":"murica.svg",
  "/hex.svg":"hex.svg",
  "/hex.png":"hex.png",
  "/tidy_32.gif":"tidy_32.gif"
}

var adminPageMap = {
  "/admin":"admin.html",
  "/approve":"approve.html"
}

loadImages();

async function loadImages() {
  var q = "SELECT filename, approved FROM fanart;";
  var response = await query(q);
  for (var i = 0; i < response.length; i++) {
    loadArt(response[i].filename, response[i].approved);
  }
  var files = await fs.readdirSync("./Fanart");
  files.forEach(function(value, index, array) {
    if (!response.some((element) => element.filename == value)) {
      loadArt(value);
      storeArt(value);
    }
  });
}

function loadArt(filename, isapproved) {
  if (isapproved == undefined) {
    isapproved = false;
  }
  var filePath = "Fanart" + path.sep + filename;
  if (isapproved) {
    pageMap["/fanart/" + filename] = filePath;
  }
  else {
    adminPageMap["/fanart/unapproved/" + filename] = filePath;
  }
}
async function storeArt(filename, isapproved) {
  if (isapproved == undefined) {
    isapproved = false;
  }
  var q = "INSERT IGNORE INTO fanart (filename, approved) VALUES (?, ?);";
  await query(q, [filename, isapproved]);
}
function approveArt(filename, approve) {
  if (approve == undefined) {
    approve = true;
  }
  var q = "UPDATE fanart SET approved=? WHERE filename=?;";
  query(q, [approve, filename]);
  loadArt(filename, true);
}
function unapproveArt(filename) {
  approveArt(filename, false);
}
async function deleteArt(filename) {
  var q = "SELECT filename FROM fanart WHERE filename = ?;";
  var resp = await query(q, [filename]);
  if (resp.length > 0) {
    try {
      await fs.unlinkSync(__dirname + "/Fanart/" + resp[0].filename);
    } catch (error) {
      console.log("Unable to delete art: " + error);
    }
    var q = "DELETE FROM fanart WHERE filename = ?;";
    query(q, [resp[0].filename]);
  }
}


function start_server(port, ip) {
  const options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
  };
  var server;
  if (properties.ssl_enabled) {
    server = HTTPS.createServer(options, handle);
    server.listen(properties.https_port, ip);
    wss = SecureWebSocket.createServerFrom(server, wss_connection);
  }
  else {
    server = HTTP.createServer(handle);
    server.listen(properties.http_port, ip);
    wss = new WebSocket.Server({server});
    wss.on("connection", wss_connection);
  }
  // console.log(wss);
  
}

function wss_connection(ws) {
  notification_clients.push(ws);
  ws.on("close", client_close);
}

function client_close(ws) {
  notification_clients = notification_clients.splice(notification_clients.indexOf(ws), 1);
}

function send_notification(text) {
  var notification = {};
  notification.text = text;
  notification.timestamp = new Date();
  for (var ws in notification_clients) {
    notification_clients[ws].send(JSON.stringify(notification));
  }
}

var loggingLevel = 0;

function log(text) {
  if (loggingLevel) {
    console.log(text);
  }
}

function read_yaml() {
  try {
    var doc = yaml.safeLoad(fs.readFileSync('properties.yaml', 'utf8'));
  } catch (e) {
    console.log(e);
  }
  return doc
}

function connect_db(doc){
  con = mysql.createConnection({
    host: doc.db_host,
    user: doc.db_user,
    password: doc.db_password
  });
  con.connect(function(err) {
    if (err) throw err;
    console.log("Connected!");
  });
  var sel = "USE webtech;";
  con.query(sel, function (err, result) {
    if (err) throw err;
  })
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function try_fetch(url) {
  if (url == "http://www.station.sony.com/services/en/sorry.htm") {
    console.log("Redirect to old SOE website, ignoring");
    return;
  }
  try {
    var resp = await fetch(url);
    return resp;
  }
  catch (err) {
    if (err.type == "system") {
      throw err;
    }
    else if (error.name == "AbortError") {
      return;
    }
    else if (error.name == "FetchError")
      if (err.code == "ECONNRESET") {
        await sleep(200);
        try {
          var resp = await fetch(url);
          return resp;
        }
        catch (err) {
          return;
        }
      }
      //for some ungodly reason, occasionally the census API tries to send us to an error page on the
      //old SOE site (company that used to run Planetside 2, now non-existent)
      //we're handling it here by simply complaining about it and moving on, as the loss of one request isn't too important
      else if (err.message == "request to http://www.station.sony.com/services/en/sorry.htm failed, reason: getaddrinfo EAI_AGAIN www.station.sony.com") {
        console.log("Census API tried to redirect us to the old SOE site, request ignored.");
        return;
      }
      else {
        throw err;
      }
  }
}

//misc startup jobs and tests
async function startup() {
  auth.createUser("foo", "hunter2", true);
  auth.createUser("bar", "hunter3");
  // var auth_resp = await auth.authenticateUser("foo", "hunter2");
  // console.log(auth_resp);
}

//subscribe to census API events
function request_events() {
  let socket = new WebSocket("wss://push.planetside2.com/streaming?environment=ps2&service-id=" + serviceID);
  socket.onmessage = handle_event_response;
  socket.onopen = () => subscribe_events(socket);  
}

function subscribe_events(socket) {
  var expTypes = [7, 53, 4, 5, 51];
  var eventTypes = ["PlayerLogout", "PlayerLogin", "Death"];
  var eventNames = expTypes.map((id) => "GainExperience_experience_id_" + id).concat(eventTypes);
  // console.log(eventNames);
  socket.send(JSON.stringify({ "service": "event", "action": "subscribe", "characters": ["all"], "eventNames": eventNames, "worlds":[properties.world],"logicalAndCharactersWithWorlds":true }));
}

//handle an event sent by the API
async function handle_event_response(event) {
  var jsonData = JSON.parse(event.data);
  //console.log(jsonData);
  //ignore heartbeat messages
  if (jsonData.type == "heartbeat") {
    return
  }
  else if (jsonData.type == "serviceMessage") {
    var payload = jsonData.payload;
    switch (payload.event_name) {
      case "GainExperience":
        log(payload.experience_id);
        //revive or squad revive
        if (payload.experience_id == 7 || payload.experience_id == 53) {
          handle_revive(payload);
        }
        //heal, heal assist or squad heal
        else if (payload.experience_id == 4 || payload.experience_id == 5 || payload.experience_id == 51) {
          await create_if_new(payload.character_id);
          var sql = "UPDATE characters SET healing_ticks = IFNULL(healing_ticks, 0) + 1 WHERE id = ?;";
          var resp = await query(sql, [Number(payload.character_id)]);
        }
        else {
          return;
        }
        break;
      case "PlayerLogout":
        delete_character(payload.character_id);
        break;
      case "PlayerLogin":
        handle_login(payload);
        break;
      case "Death":
        handle_death(payload);
        break;
      default:
        return;
    }
    log(payload.event_name);
  }
}
//returns the date in a format mysql can swallow
function sql_timestamp(date) {
  var string = date.toISOString();
  var split = string.split("T");
  var dateString = split[0];
  var timeString = split[1].split(".")[0]
  return dateString + " " + timeString;
}

async function handle_login(payload) {
  await create_if_new(payload.character_id);
  var sql = "UPDATE characters SET last_login = ? WHERE id = ?;";
  query(sql, [sql_timestamp(new Date()), Number(payload.character_id)]);
}

async function handle_death(payload) {
  //death was suicide
  if (payload.character_id == payload.attacker_character_id) {
    await create_if_new(payload.attacker_character_id);
    var suicide = "UPDATE characters SET suicides = IFNULL(suicides, 0) + 1 WHERE id = ?;";
    query(suicide, [Number(payload.character_id)]);
    return;
  }
  var victim = await get_character_data(payload.character_id, "faction_id");
  var attacker = await get_character_data(payload.attacker_character_id, "faction_id");
  if (!(victim && attacker)) {
    log("API cannot find player");
    return;
  }
  //death was teamkill
  if (victim.faction_id == attacker.faction_id) {
    await create_if_new(payload.attacker_character_id);
    var updateCount = "UPDATE characters SET teamkills = IFNULL(teamkills, 0) + 1 WHERE id = ?;";
    query(updateCount, [Number(payload.attacker_character_id)]);
    var clearTKs = "DELETE FROM teamkills WHERE victim_id = ?;";
    await query(clearTKs, [Number(payload.character_id)]);
    var insertTK =  "INSERT INTO teamkills (victim_id, attacker_id) VALUES (?, ?);";
    query(insertTK, [Number(payload.character_id), Number(payload.attacker_character_id)]);
  }
}

async function handle_revive(payload) {
  // console.log("revive received");
  await create_if_new(payload.character_id);
  await create_if_new(payload.other_id);
  //actually increase the resurrections count
  var sql = "UPDATE characters SET resurrections = IFNULL(resurrections, 0) + 1 WHERE id = ?;";
  query(sql, [Number(payload.character_id)]);
  sql = "UPDATE characters SET times_revived = IFNULL(times_revived, 0) + 1 WHERE id = ?;";
  query(sql, [Number(payload.other_id)]);
  send_notification("A player has been revived");
  //check if this is a forgiveness revive
  var getTKs = "SELECT id FROM teamkills WHERE victim_id=? AND attacker_id=?;";
  var result = await query(getTKs, [Number(payload.other_id), Number(payload.character_id)]);
  if (result.length > 0) {
    var getName = "SELECT username FROM characters WHERE id = ?;";
    var victimName = await query(getName, [Number(payload.other_id)]);
    var attackerName = await query(getName, [Number(payload.character_id)]);
    var text = attackerName[0].username + " just revived " + victimName[0].username + " after teamkilling them, perhaps all is forgiven now.";
    // console.log(text);
    send_notification(text);
    var forgive = "DELETE FROM teamkills WHERE victim_id=? AND attacker_id=?;";
    query(forgive, [Number(payload.other_id), Number(payload.character_id)]);
  }
}

//creates a new character entry only if that character does not exist in the database
async function create_if_new(id) {
  var exists = await character_exists(id);
  if (!exists) {
    await create_character(id);
  }
}

//wrapper for a request to the census API to get character data
//list of possible properties can be found here: http://census.daybreakgames.com/get/ps2/
async function get_character_data(id, ...properties) {
  var params = "";
  if (properties) {
    params = "&c:show=";
    params += properties.join("&c:show=");
  }
  var requestString = "http://census.daybreakgames.com/"+ serviceID +"/get/ps2:v2/character/?character_id=" + id + params;
  //console.log(requestString)
  var result = await try_fetch(requestString);
  if (result.status != 200) {
    console.log("API returned invalid response code " + result.status);
    return;
  }
  var jsonData = await result.json();
  if (jsonData.character_list) {
    return jsonData.character_list[0];
  }
}

//duplicate safe function to create a character entry from their id
async function create_character(id){
  //request username and faction id from the api
  var character = await get_character_data(id, "name", "faction_id");
  if (!character) {
    //console.log("character does not exist")
  }
  else {
    var sql = "INSERT IGNORE INTO characters (id, username, faction_id) VALUES (?,?,?);";
    await query(sql, [Number(id), character.name.first, character.faction_id]);
  }
}

async function delete_character(id) {
  var deletChar = "DELETE FROM characters WHERE id = ?;";
  var deletTKs = "DELETE FROM teamkills WHERE victim_id = ? OR attacker_id = ?;";
  query(deletChar, [Number(id)]);
  query(deletTKs, [Number(id), Number(id)]);
}
async function character_exists(id) {
  var results = await query("SELECT id FROM characters WHERE id =?;", [Number(id)]);
  return results.length > 0;
}

//main HTTP handle function
function handle(request, response) {
  // sessions gubbins
  requestSessionHandler(request, response, function () {
    if (request.session.seenyou) {
      response.setHeader('X-Seen-You', 'true');
    } else {
        // setting a property will automatically cause a Set-Cookie response
        // to be sent
        request.session.seenyou = true;
        response.setHeader('X-Seen-You', 'false');
    }
  });

  var params = parse_parameters(request.url);
  // console.log(params)
  log("Method:", request.method);
  log("URL:", request.url);
  log("Params: ", params)

  if (request.method == "GET") {
    handle_get(request, response, params)
  }
  else if (request.method == "POST") {
    handle_post(request, response, params)
  }
}

async function handle_get(request, response, params) {
  log("params")
  log(params)
  log("get request with url: " + request.url)

  var columns = ["username", "suicides", "teamkills", "healing_ticks", "resurrections", "times_revived", "faction_id"];

  //check if the requested URL maps to a file
  var file = pageMap[request.url];
  if (adminPageMap[request.url]) {
    if (request.session.admin) {
      file = adminPageMap[request.url];
    }
    else { //forboden
      response.writeHead(403).end();
      return;
    }
  }
  if (file) {
    log("Filename found: " + file);
    var type = mime.contentType(file);
    log("Content-Type: " + type);
    //if it's an HTML page, send it off for templating
    if (type.includes("text/html")) {
      send_page(file, request, response);
    }
    else { //otherwise just send the file
      send_file(file, response, type);
    }
  }
  // else if (request.url.startsWith("/notifications")) {
  //   reply(response, JSON.stringify(notifications), "text/json");
  // }
  else if (request.url.startsWith("/api/")) {
    var name = request.url.substring(5).split("?")[0];
    if (name==""){
      name = "resurrections"
    }
    // console.log(name)
    if (columns.includes(name)){
      if (params.count) {
        var count = params.count;
      }
      else {
        var count = 10;
      }
      if (params.factions){
        var factions=JSON.parse("[" + params.factions + "]");
      }
      else {
        var factions=[1,2,3,4];
      }
      var iord = "DESC";
      // console.log("fetching")
      var sql = "SELECT username, resurrections, suicides, teamkills, times_revived,faction_id FROM characters WHERE faction_id in (" + factions + ") ORDER BY " + name + " "+ iord +" LIMIT " + count +";";
      var result = await query(sql);
      // console.log("AAA")
      // console.log(result)
      var jsonObject = {};
      result.forEach(function (value, index, array) {
        var obj = {};
        for (var col in columns) {
          obj[columns[col]] = value[columns[col]];
        }
        jsonObject[index] = obj;
      });
      //console.log(jsonObject);
      var content = JSON.stringify(jsonObject);
      //console.log(content)
      reply(response, content, "text/plain");
    }
  }
  else if (request.url.startsWith("/fanart/approve")) {
    if (request.session.loggedin && request.session.admin) {
        approveArt(params.img);
        reload(request, response);
    }
  }
  else if (request.url.startsWith("/fanart/delet")) {
    if (request.session.loggedin && request.session.admin) {
      deleteArt(params.img);
      reload(request, response);
    }
  }
  log("");
}

async function handle_post(request, response, params) {
  var url = request.url;
  console.log(request.url)
  if (url == "/fanart") {
    if (!request.session.loggedin) {
      return;
    }
    var form = new formidable.IncomingForm();
    form.parse(request, parse_fanart);
    await response.writeHead(204); //respond with "204: no content" to prevent the browser trying to load the page
    response.end();
  }
  else if (request.url.startsWith("/logout")) {
    log("logging out")
    request.session.reset();
    redirect(response, "/");
  }
  else if (url == "/login") {
    // console.log("login post received");
    var form = new formidable.IncomingForm();
    form.parse(request,
      async function(err, fields, files) {
        if (err) throw err;
        console.log(fields);
        var authResult = await auth.authenticateUser(fields.username, fields.password);
        if (authResult) {
          request.session.loggedin = true;
          request.session.username = fields.username;
          if (authResult == "admin") {
            request.session.admin = true;
          }
          await response.writeHead(302, {"Location":"/"});
          response.end();
        }
      });
  }
}

async function parse_fanart(err, fields, files) {
  if (err) throw err;
  log("Files uploaded " + JSON.stringify(files));
  await fs.rename(files.filename.path, __dirname + path.sep + "Fanart" + path.sep + files.filename.name, (err) => {if (err) throw err;});
  loadArt(files.filename.name);
  storeArt(files.filename.name)
}

async function redirect(response, location) {
  await response.writeHead(302, {"Location":location});
  await response.end();
}

async function reload(request, response) {
  await redirect(response, request.headers.referer);
}

//returns a dict mapping parameter names to values
function parse_parameters(url){
  // console.log(url)
  var dict = {};
  if (url.includes("?")){
    var temp = url.split("?").pop();
    // console.log(temp)
    let params = temp.split("&");  
    // console.log(params)
    for (var i in params){
      var p = params[i];
      // console.log(typeof(p));
      var name = p.substring(0,p.indexOf("="));
      var value = p.substring(p.indexOf("=")+1, p.length);
      dict[name] = value;
    }
  }
  // console.log(dict)
  return dict;
}

async function getFanartNames(approved) {
  var q = "SELECT filename FROM fanart WHERE " + (!approved ? "NOT" : "") +" approved;" //yeah okay but it's fixed values so it's fine
  var result = await query(q);
  return result.map((element) => element.filename); //convert the SQL results into a simple array
}

//template and send an HTML page
async function send_page(filePath, request, response) {
  var content = await fs.readFileSync("./Resources/" + filePath, "utf8");
  var templateMap = {};
  //here we add stuff to the template map to be sent to the client
  templateMap.loggedin = request.session.loggedin;
  if (templateMap.loggedin) {
    templateMap.username = request.session.username;
  }
  if (filePath == "index.html") {
    var time = (new Date()).toDateString();
    templateMap["time"] = time;
  }
  else if (filePath == "fanart.html") {
    templateMap["images"] = await getFanartNames(true);
  }
  else if (filePath == "approve.html") {
    templateMap["images"] = await getFanartNames(false);
  }
  content = templating.template(content, templateMap);
  // console.log("Content: " + content);
  reply(response, content, 'text/html');
}


//just read and send a file normally
async function send_file(filePath, response, mimeType) {
  var content
  if (mimeType.includes("text")) {
    content = await fs.readFileSync("./Resources/" + filePath, "utf8");
  }
  else {
    content = await fs.readFileSync("./Resources/" + filePath);
  }
  reply(response, content, mimeType);
}


// Send a reply.
function reply(response, content, mimeType) {
  let hdrs = { 'Content-Type': mimeType };
  response.writeHead(200, hdrs);  // 200 = SNAZZY
  if (content != null) {
    response.write(content);
  }
  response.end();
}