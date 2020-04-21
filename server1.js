"use strict"
let HTTP = require('http');
let mime = require("mime-types");
let mysql = require("mysql");
let fetch = require("node-fetch");
let yaml = require('js-yaml');
let fs = require('fs');
let formidable = require('formidable');
let path = require('path');
let util = require('util');
const WebSocket = require('ws');

//database connection, global because passing it around seems pointless
var con;

//daybreak API ID
var serviceID = "s:jtwebtech"

//websocket server to send notifications to clients
var wss;
var notification_clients = [];

//start the HTTP server
start_server(8080);
//connect to the mySQL server using the credentials from the properties file
var properties = read_yaml();
connect_db(properties);
//set up promisified version of the query method so we can await it
const query = util.promisify(con.query).bind(con);
//subscribe to the exp gained events from the API
request_events();

var pageMap = {
  "/":"index.html",
  "/fanart":"fanart.html",
  "/test":"test.txt",
  "/style.css":"style.css",
  "/fanart.css":"fanart.css",
  "/VSlogo.svg":"aliens.svg",
  "/TRlogo.svg":"sword.svg",
  "/NClogo.svg":"murica.svg"
}

loadImages();

var fanart = [];

async function loadImages() {
  fanart = await fs.readdirSync("./Fanart");
  fanart.forEach(function(value, index, array) {
    pageMap["/" + value] = "Fanart" + path.sep + value;
  });
}

// Provide a service to localhost only.
function start_server(port) {
  let service = HTTP.createServer(handle);
  wss = new WebSocket.Server({server: service});
  wss.on("connection", wss_connection);
  service.listen(port);
}

function wss_connection(ws) {
  console.log("ho")
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
    ws.send(JSON.stringify(notification));
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
    host: doc.host,
    user: doc.user,
    password: doc.password
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
    else if (error.name == "FetchError" && err.code == "ECONNRESET") {
      await sleep(200);
      try {
        var resp = await fetch(url);
        return resp;
      }
      catch (err) {
        return;
      }
    }
    else {
      throw err;
    }
  }
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
  console.log(eventNames);
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
        console.log(payload.experience_id);
        //revive or squad revive
        if (payload.experience_id == 7 || payload.experience_id == 53) {
          handle_revive(payload);
        }
        //heal, heal assist or squad heal
        else if (payload.experience_id == 4 || payload.experience_id == 5 || payload.experience_id == 51) {
          await create_if_new(payload.character_id);
          var sql = "UPDATE characters SET healing_ticks = IFNULL(healing_ticks, 0) + 1 WHERE id = " + payload.character_id + ";";
          var resp = await query(sql);
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
    console.log(payload.event_name);
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
  var sql = "UPDATE characters SET last_login = '" + sql_timestamp(new Date()) + "' WHERE id = " + payload.character_id + ";";
  query(sql);
}

async function handle_death(payload) {
  //death was suicide
  if (payload.character_id == payload.attacker_character_id) {
    await create_if_new(payload.attacker_character_id);
    var suicide = "UPDATE characters SET suicides = IFNULL(suicides, 0) + 1 WHERE id = " + payload.character_id + ";";
    query(suicide);
    return;
  }
  var victim = await get_character_data(payload.character_id, "faction_id");
  var attacker = await get_character_data(payload.attacker_character_id, "faction_id");
  if (!(victim && attacker)) {
    console.log("API cannot find player");
    return;
  }
  //death was teamkill
  if (victim.faction_id == attacker.faction_id) {
    await create_if_new(payload.attacker_character_id);
    var updateCount = "UPDATE characters SET teamkills = IFNULL(teamkills, 0) + 1 WHERE id = " + payload.attacker_character_id + ";";
    query(updateCount);
    var clearTKs = "DELETE FROM teamkills WHERE victim_id = " + payload.character_id + ";";
    await query(clearTKs);
    var insertTK =  "INSERT INTO teamkills (victim_id, attacker_id) VALUES (" + payload.character_id + ", " + payload.attacker_character_id + ");";
    query(insertTK);
  }
}

async function handle_revive(payload) {
  // console.log("revive received");
  await create_if_new(payload.character_id);
  await create_if_new(payload.other_id);
  //actually increase the resurrections count
  var sql = "UPDATE characters SET resurrections = IFNULL(resurrections, 0) + 1 WHERE id = "+ payload.character_id +";";
  query(sql);
  sql = "UPDATE characters SET times_revived = IFNULL(times_revived, 0) + 1 WHERE id = "+ payload.other_id +";";
  query(sql);
  //check if this is a forgiveness revive
  var getTKs = "SELECT COUNT(1) FROM teamkills WHERE victim_id=" + payload.other_id + " AND attacker_id=" + payload.character_id + ";";
  var result = await query(getTKs);
  if (result[0]["COUNT(1)"] > 0) {
    var getName = "SELECT username FROM characters WHERE id = ";
    var victimName = await query(getName + payload.other_id + ";");
    var attackerName = await query(getName + payload.character_id + ";");
    var text = attackerName[0].username + " just revived " + victimName[0].username + " after teamkilling them, perhaps all is forgiven now.";
    console.log(text);
    send_notification(text);
    var forgive = "DELETE FROM teamkills WHERE victim_id=" + payload.other_id + " AND attacker_id=" + payload.character_id + ";";
    query(forgive);
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
    //console.log(character);
    //for some reason this is the best way to do duplicate safe insertion
    var sql = "INSERT INTO characters(id, username, faction_id) VALUES (" + id + ",'" + character.name.first +"'," + character.faction_id + ") ON DUPLICATE KEY UPDATE id=id;";
    await query(sql);
  }
}

async function delete_character(id) {
  var deletChar = "DELETE FROM characters WHERE id = " + id;
  var deletTKs = "DELETE FROM teamkills WHERE victim_id = " + id + " OR attacker_id = " + id + ";";
  query(deletChar);
  query(deletTKs);
}
async function character_exists(id) {
  var results = await query("SELECT COUNT(id) FROM characters WHERE id =" + id + ";");
  return results[0]["COUNT(id)"] != 0;
}

// //reflect a received API request on to the census API
// async function call_api(request,response){
//   var i=request.url.indexOf("api")+4
//   var apiresponse = await try_fetch("http://census.daybreakgames.com/s:jtwebtech/" + request.url.slice(i));
//   var text = await apiresponse.text()
//   reply(response, text, mime.contentType(".json"));
// }

//main HTTP handle function
function handle(request, response) {
  var params = parse_parameters(request.url);
  
  console.log("Method:", request.method);
  console.log("URL:", request.url);
  console.log("Params: ", params)

  if (request.method == "GET") {
    handle_get(request, response, params)
  }
  else if (request.method == "POST") {
    handle_post(request, response, params)
  }
}

async function handle_get(request, response, params) {
  var columns = ["username", "suicides", "teamkills", "healing_ticks", "resurrections", "times_revived", "faction_id"];
  //check if the requested URL maps to a file
  var file = pageMap[request.url];
  if (file) {
    console.log("Filename found: " + file);
    var type = mime.contentType(file);
    console.log("Content-Type: " + type);
    //if it's an HTML page, send it off for templating
    if (type.includes("text/html")) {
      send_page(file, response);
    }
    else { //otherwise just send the file
      send_file(file, response, type);
    }
  }
  else if (request.url.startsWith("/notifications")) {
    reply(response, JSON.stringify(notifications), "text/json");
  }
  else if (request.url.startsWith("/api/")) {
    console.log("hello")
    var name = request.url.substring(5);
    if (name==""){
      name = "resurrections"
    }
    console.log(name)
    if (columns.includes(name)){
      console.log("we're in bois")
      if (params.count) {
        var count = params.count;
      }
      else {
        var count = 10;
      }
      var sql = "SELECT username, resurrections, suicides, teamkills, times_revived FROM characters ORDER BY "+ name +" DESC LIMIT "+ count +";";
      var result = await query(sql);
      console.log("AAA")
      console.log(result)
      //build a string from the SQL result array
      var content = result.map((x) => "(" + x.username + "," + x.resurrections + ")").join(", "); //TODO: fix jonny's dumb ass
      reply(response, content, "text/plain");
    }
  }
  console.log();
}

function handle_post(request, response, params) {
  var url = request.url;
  if (url == "/fanart") {
    var form = new formidable.IncomingForm();
    form.parse(request, parse_fanart);
    response.writeHead(204); //respond with "204: no content" to prevent the browser trying to load the page
    response.end();
  }
}

function parse_fanart(err, fields, files) {
  if (err) throw err;
  console.log("Files uploaded " + JSON.stringify(files));
  fs.rename(files.filename.path, __dirname + path.sep + "Fanart" + path.sep + files.filename.name, (err) => {if (err) throw err;});
}

//returns a dict mapping parameter names to values
function parse_parameters(url){
  console.log(url)
  var dict = {};
  if (url.includes("?")){
    var temp = url.split("?").pop();
    console.log(temp)
    let params = temp.split("&");  
    console.log(params)
    for (var i in params){
      var p = params[i];
      console.log(typeof(p));
      var name = p.substring(0,p.indexOf("="));
      var value = p.substring(p.indexOf("=")+1, p.length);
      dict[name] = value;
    }
  }
  console.log(dict)
  return dict;
}

//template and send an HTML page
async function send_page(filePath, response) {
  var content = await fs.readFileSync("./" + filePath, "utf8");
  var templateMap = {};
  //here we add stuff to the template map to be sent to the client
  if (filePath == "index.html") {
    var time = (new Date()).toDateString();
    templateMap["time"] = time;
  }
  else if (filePath == "fanart.html") {
    templateMap["images"] = fanart;
    templateMap["test"] = "heh";
  }
  content = template(content, templateMap);
  // console.log("Content: " + content);
  reply(response, content, 'text/html');
}

//takes the page content string and a map of variable names to values
//returns the same content with the names changed to values
function template(content, templateMap) {
  var i = content.indexOf("$");
  while(i != -1) {
    //basic substitution
    i++;
    if (content[i] == '{') {
      
      var end = content.indexOf("}", i);
      if (end != -1) {
        var key = content.substring(i + 1, end);
        if (templateMap[key]) {
          content = content.split("${" + key + "}").join(templateMap[key]);
        }
      }
      else {
        break;
      }
    }
    //foreach substitution
    //currently does now allow for nested foreachs
    else if (content.substring(i).startsWith("foreach(")) {
      //console.log("templating foreach");
      var bracketEnd = content.indexOf(")", i);
      if (bracketEnd == -1) {
        console.log("malformed foreach templating at " + i);
        break;
      }
      var inside = content.substring(i + "foreach(".length, bracketEnd).split(" in ");
      var keyName = inside[0];
      //console.log("key name = " + keyName);
      var array = templateMap[inside[1]];
      //console.log("array = " + array);
      var end = content.indexOf("endfor", i);
      if (end == -1) {
        console.log("malformed foreach templating at " + i);
        break;
      }
      var body = content.substring(bracketEnd + 1, end);
      //console.log("body: " + body);
      let newContent = "";
      array.forEach(function(value, index, array) {
        //recurse down to template the body
        var map = {};
        map[keyName] = value;
        var block = template(body, map);
        //console.log("block = " + block);
        newContent = newContent.concat(block);
      });
      //console.log("new content = " + newContent);
      //replace the template with the templated blocks
      content = content.substring(0, i - 1) + newContent + content.substring(end + "endfor".length);
    }
    else {
      console.log("lone $ found in templating");
      break;
    }
    i = content.indexOf("$");
  }
  console.log(content);
  return content;
}

//just read and send a file normally
async function send_file(filePath, response, mimeType) {
  // var stream = fs.createReadStream("./" + filePath);
  // stream.on("open", function (fd) {
  //   stream.pipe(response);
  //   reply(response, null, mimeType);
  // })
  var content
  if (mimeType.includes("text")) {
    content = await fs.readFileSync("./" + filePath, "utf8");
  }
  else {
    content = await fs.readFileSync("./" + filePath);
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