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
let dbmodule = require("./dbmodule.js")
const WebSocket = require('ws');
const SecureWebSocket = require('wss');

var properties = read_yaml();

const formidableOptions = {
  maxFileSize: 10 * 1024 * 1024,
  maxFields: 50,
  uploadDir: __dirname + path.sep + "Resources" + path.sep + "Fanart" + path.sep
}

var requestSessionHandler = sessions({
  cookieName: "session",
  secret: properties.cookie_secret || "there are no wolves on fenris",
  duration: 24 * 60 * 60 * 1000,
  activeDuration: 1000 * 60 * 5
});

var query;
async function setup_database(properties) {
  query = await dbmodule.connect_db(properties.db_host, properties.db_user, properties.db_password);
  auth.setQueryMethod(query);
}
setup_database(properties);

var loggingLevel = 0;

function log(text) {
  if (loggingLevel) {
    console.log(text);
  }
}

//daybreak API ID
var serviceID = properties.census_id;
if (!serviceID) {
  console.log("Missing service id, please set \"census_id\" in the properties file");
}

//websocket server to send notifications to clients
var wss;
var notification_clients = [];

//start the HTTP server
start_server(properties.http_port, properties.server_ip);

startup();
//subscribe to the exp gained events from the API
request_events();

var pageMap = {
  "/":"index.html",
  "/navbar":"navbar.html",
  "/favicon.ico":"favicon.ico", //we have to serve this locally because deybreak's cdn is weird
  "/fanart":"fanart.html",
  "/test":"test.txt",
  "/errorpage":"errorpage.html",
  "/errorpage.css":"errorpage.css",
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
  "/admin.css":"admin.css",
  "/approve":"approve.html"
}

loadImages();

async function loadImages() {
  var response = await dbmodule.SELECT("fanart",["filename","approved"],[],[],[], [],0,false);
  // var q = "SELECT filename, approved FROM fanart;";
  // var response = await query(q);
  for (var i = 0; i < response.length; i++) {
    loadArt(response[i].filename, response[i].approved);
  }
  var files = await fs.readdirSync("./Resources/Fanart");
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
async function storeArt(filename, isapproved, user_id) {
  if (isapproved == undefined) {
    isapproved = false;
  }
  if (user_id == undefined) {
    user_id = 1;
  }
  await dbmodule.INSERT("fanart",["filename", "approved", "user_id"],[filename, isapproved, user_id],true);
}
function approveArt(filename, approve) {
  if (approve == undefined) {
    approve = true;
  }
  dbmodule.UPDATE("fanart",["approved","filename"],[approve, filename]);
  loadArt(filename, true);
}
function unapproveArt(filename) {
  approveArt(filename, false);
}
async function deleteArt(filename) {
  var resp = await dbmodule.SELECT("fanart",["id"],[],[["filename",filename]],[], [],0,false);
  if (resp.length > 0) {
    try {
      await fs.unlinkSync(__dirname + "/Resources/Fanart/" + resp[0].filename);
    } catch (error) {
      console.log("Unable to delete art: " + error);
    }
    await dbmodule.DELETE("comments", ["fanart_id"],[resp[0].id] );
    await dbmodule.DELETE("fanart", ["filename"],[filename] );
  }
}


function start_server(port, ip) {
  var server;
  if (properties.ssl_enabled) { //start an HTTPS server and secure websocket server to go along with it
    const options = {
      key: fs.readFileSync(properties.ssl_key_path),
      cert: fs.readFileSync(properties.ssl_cert_path)
    };
    server = HTTPS.createServer(options, handle);
    server.listen(properties.https_port, ip);
    wss = SecureWebSocket.createServerFrom(server, wss_connection);
  }
  else { //start an HTTP server and normal websocket server to go along with it
    server = HTTP.createServer(handle);
    server.listen(properties.http_port, ip);
    wss = new WebSocket.Server({server});
    wss.on("connection", wss_connection);
  }
}

function wss_connection(ws) {
  notification_clients.push(ws);
  ws.on("close", client_close);
}

function client_close(ws) {
  notification_clients = notification_clients.splice(notification_clients.indexOf(ws), 1);
}

//sends a notification out to every client to appear on the index page
function send_notification(text) {
  var notification = {};
  notification.text = text;
  notification.timestamp = new Date();
  for (var ws in notification_clients) {
    try {
      notification_clients[ws].send(JSON.stringify(notification));
    }
    catch (err) {
      if (err.message == "not opened") {
        client_close(ws);
      }
      else {
        throw err;
      }
    }
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function try_fetch(url) {
  try {
    var resp = await fetch(url);
    return resp;
  }
  catch (err) {
    console.log("Fetch error: " + err.message);
    return resp;
  }
}

//misc startup jobs and tests
async function startup() {
  auth.createUser("foo", "hunter2", true);
  auth.createUser("bar", "hunter3");
  auth.createUser("a", "hunter3");
  auth.createUser("b", "hunter3");
  auth.createUser("c", "hunter3");
  auth.createUser("d", "hunter3");
  auth.createUser("e", "hunter3");
  auth.createUser("f", "hunter3");
  auth.createUser("g", "hunter3");
  auth.createUser("h", "hunter3");
  auth.createUser("i", "hunter3");
  auth.createUser("σεφησδφκ", "hunter2");
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
  socket.send(JSON.stringify({ "service": "event", "action": "subscribe", "characters": ["all"], "eventNames": eventNames, "worlds":[properties.world],"logicalAndCharactersWithWorlds":true }));
}

//handle an event sent by the API
async function handle_event_response(event) {
  var jsonData = JSON.parse(event.data);
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
          await dbmodule.UPDATE("characters",["healing_ticks","id"],[Number(payload.character_id)]);
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
  dbmodule.UPDATE("characters",["last_login","id"],[sql_timestamp(new Date()), Number(payload.character_id)]);
  var character = await get_character_data(payload.character_id, "name")
  if (character) {
    send_notification(character.name.first + " has logged in");
  }
}

async function handle_death(payload) {
  //death was suicide
  if (payload.character_id == payload.attacker_character_id) {
    await create_if_new(payload.attacker_character_id);
    dbmodule.UPDATE("characters",["suicides","id"],[Number(payload.character_id)]);
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
    dbmodule.UPDATE("characters",["teamkills","id"],[Number(payload.attacker_character_id)]);
    await dbmodule.DELETE("teamkills", ["victim_id"],[Number(payload.character_id)] );
    await dbmodule.INSERT("teamkills",["victim_id", "attacker_id"],[Number(payload.character_id), Number(payload.attacker_character_id)]);
  }
}

async function handle_revive(payload) {
  await create_if_new(payload.character_id);
  await create_if_new(payload.other_id);
  //actually increase the resurrections count
  dbmodule.UPDATE("characters",["resurrections","id"],[Number(payload.character_id)]);
  dbmodule.UPDATE("characters",["times_revived","id"],[Number(payload.other_id)]);
  var victimName = await dbmodule.SELECT("characters",["username"],[],[["id",Number(payload.other_id)]],[], [],0,false);
  send_notification(victimName[0].username + " has been revived");
  //check if this is a forgiveness revive
  var result =  await dbmodule.SELECT("teamkills",["id"],[],[["victim_id",Number(payload.other_id)],["attacker_id",Number(payload.character_id)]],["AND"], [],0,false);
  if (result.length > 0) {
    var attackerName =  await dbmodule.SELECT("characters",["username"],[],[["id",Number(payload.character_id)]],[], [],0,false);
    var text = attackerName[0].username + " just revived " + victimName[0].username + " after teamkilling them, perhaps all is forgiven now.";
    send_notification(text);
    dbmodule.DELETE("teamkills", ["victim_id", "attacker_id"],[Number(payload.other_id), Number(payload.character_id)], ["AND"] );
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
  var result = await try_fetch(requestString);
  if (!result) {
    console.log("No response from API");
    return;
  }
  else if (result.status != 200) {
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
    console.log("Deybreak refuse to give us data on character id " + id + " perhaps a new character or the API borked");
  }
  else {
    await dbmodule.INSERT("characters",['id', 'username', 'faction_id'],[Number(id), character.name.first, character.faction_id],true);
  }
}

async function delete_character(id) {
  await dbmodule.DELETE("characters", ["id"],[Number(id)]);
  await dbmodule.DELETE("teamkills", ["victim_id", "attacker_id"],[Number(id), Number(id)], ["OR"] );
}
async function character_exists(id) {
  var results =  await dbmodule.SELECT("characters",["id"],[],[["id",Number(id)]],[], [],0,false);
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
  else if (request.url.startsWith("/admin/")) {
    if (request.session.admin) {
      var result =  await dbmodule.SELECT("users",["username","admin"],["admin","adminStatus"],[],["username","ASC"], [],0,false);
      var content = JSON.stringify(result);
      reply(response, content, "text/plain");
    }
  }
  else if (request.url.startsWith("/api/")) {
    var name = request.url.substring(5).split("?")[0];
    if (name==""){
      name = "resurrections"
    }
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
      var result=await dbmodule.SELECT("characters",["username", "resurrections","suicides","teamkills","times_revived","faction_id"],[],[["faction_id",factions]],[], [name,iord],count,false);
      var jsonObject = {};
      result.forEach(function (value, index, array) {
        var obj = {};
        for (var col in columns) {
          obj[columns[col]] = value[columns[col]];
        }
        jsonObject[index] = obj;
      });
      var content = JSON.stringify(jsonObject);
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
      await deleteArt(params.img);
      reload(request, response);
    }
  }
  else if (request.url.startsWith("/search")){
    var username=request.url.substring(8);
    var result = await dbmodule.SELECT("characters",["username", "resurrections","suicides","teamkills","times_revived","faction_id"],[],[["username",username]],[], [],1,false);
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
  else {
    send_page(pageMap["/errorpage"], request, response);
  }
  log("");
}

async function handle_post(request, response, params) {
  var url = request.url;
  // console.log(request.url)
  if (url == "/fanart") { //endpoint for uploading fanart
    if (!request.session.loggedin) {
      return;
    }
    var form = new formidable.IncomingForm(formidableOptions);
    form.parse(request, (err, fields, files) => parse_fanart(err, fields, files, request));
    await response.writeHead(204); //respond with "204: no content" to prevent the browser trying to load the page
    response.end();
  }
  else if (request.url.startsWith("/fanart/comment")) { //endpoint for posting comments on fanart
    var form = formidable.IncomingForm(formidableOptions);
    var userId = await get_user_id(request.session.username);
    form.parse(request, (err, fields, files) => {
      if (err) throw err;
      if (fields.parent_id == "undefined" || fields.parent_id == "") { //top level comment
        fields.parent_id = undefined;
      }
      else {
        fields.parent_id = Number(fields.parent_id);
      }
      post_comment(Number(fields.fanart_id), userId, fields.content, fields.parent_id);
    })
    reload(request, response);
  }
  else if (request.url.startsWith("/logout")) {
    log("logging out")
    request.session.reset();
    redirect(response, "/");
  }
  else if (url == "/login") {
    var form = new formidable.IncomingForm(formidableOptions);
    form.parse(request,
      async function(err, fields, files) {
        if (err) throw err;
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
  else if (url == "/delete-user") {
    var form = new formidable.IncomingForm(formidableOptions);
    form.parse(request, (err, fields, files) => auth.deleteUser(fields.adminUser, fields.adminPass, fields.usernameToDelete));
    reload(request, response);
  }
}

async function parse_fanart(err, fields, files, request) {
  if (err) throw err;
  log("Files uploaded " + JSON.stringify(files));
  var mimetype = mime.contentType(files.filename.name);
  if (["image/jpeg", "image/png", "image/bmp"].indexOf(mimetype) != -1) {
    var filename = files.filename.path + "." + files.filename.name.split(".").pop();
    await fs.rename(files.filename.path, filename, (err) => {if (err) throw err;});
    loadArt(filename);
    storeArt(filename, false, await get_user_id(request.session.username));
  }
  else {
    await fs.unlink(files.filename.path, (err) => {if (err) throw err;});
  }
}

async function get_user_id(username) {
  var result = await dbmodule.SELECT("users",["id"],[],[["username",username]],[], [],1,false);
  // var q = "SELECT id FROM users WHERE username=?;";
  // var result = await query(q, [username]);
  return result[0].id;
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
  var dict = {};
  if (url.includes("?")){
    var temp = url.split("?").pop();
    let params = temp.split("&");
    for (var i in params){
      var p = params[i];
      var name = p.substring(0,p.indexOf("="));
      var value = p.substring(p.indexOf("=")+1, p.length);
      dict[name] = value;
    }
  }
  return dict;
}

async function getFanart(approved) {
  var result = await dbmodule.SELECT("fanart",["id", "filename","user_id"],[],[["approved",approved]],[], [],0,false);
  return result;
}

async function getCommentChildren(comment) {
  var children = await dbmodule.SELECT("comments",["*"],[],[["parent_id",comment.id]],[], [],0,false);
  if (children.length > 0) {
    for (let child of children) {
      child.children = await getCommentChildren(child);
    }
    return children;
  }
  return [];
}

async function post_comment(fanart_id, user_id, content, parent_id) {
  //cause apparently mysql can't understand nulls even though it should
  if (parent_id != undefined) {
    await dbmodule.INSERT("comments",['fanart_id', 'user_id', 'content', "parent_id"],[fanart_id, user_id, content, parent_id]);
  }
  else {
    await dbmodule.INSERT("comments",['fanart_id', 'user_id', 'content'],[fanart_id, user_id, content]);
  }
  var result = await dbmodule.SELECT(0,[],[],[],[], [],0,true);
  return result[0]["LAST_INSERT_ID()"];
}

//template and send an HTML page
async function send_page(filePath, request, response) {
  var content = await fs.readFileSync("./Resources/" + filePath, "utf8");
  var templateMap = {};
  //here we add stuff to the template map to be sent to the client
  templateMap.session=request.session;
  if (filePath == "index.html") {
    var time = (new Date()).toDateString();
    templateMap["time"] = time;
  }
  else if (filePath == "fanart.html") {
    var images = await getFanart(true);
    for (let img of images) {
      var topLevels = await dbmodule.SELECT("comments",["*"],[],[["fanart_id",img.id],["parent_id","NULL"]],["AND"], [],0,false);
      for (let comment of topLevels) {
        comment.children = await getCommentChildren(comment);
      }
      img.comments = topLevels;
    }
    templateMap.images = images;
    var result = await dbmodule.SELECT("users",["username","id"],[],[],[], [],0,false);
    var userMap = {};
    for (var user of result) {
      userMap[user.id] = user.username;
    }
    templateMap.users = userMap;
  }
  else if (filePath == "approve.html") {
    templateMap["images"] = await getFanart(false);
  }
  content = templating.template(content, templateMap);
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