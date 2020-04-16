"use strict"
let HTTP = require('http');
let FS = require("fs");
let mime = require("mime-types");
let mysql = require("mysql");
let fetch = require("node-fetch");
let yaml = require('js-yaml');
let fs = require('fs');
let formidable = require('formidable');
let path = require('path');
const WebSocket = require('ws');

//database connection, global because passing it around seems pointless
var con;

//daybreak API ID
var serviceID = "s:jtwebtech"

//start the HTTP server
start_server(8080);
//connect to the mySQL server using the credentials from the properties file
connect_db(read_yaml());
//subscribe to the exp gained events from the API
request_exp();

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
  service.listen(port, 'localhost');
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

function request_exp() {
  let socket = new WebSocket("wss://push.planetside2.com/streaming?environment=ps2&service-id=" + serviceID);
  socket.onmessage = handle_exp_response;
  socket.onopen = () => subscribe_exp(socket);  
}

function subscribe_exp(socket) {
  socket.send(JSON.stringify({ "service": "event", "action": "subscribe", "characters": ["all"], "eventNames": ["GainExperience_experience_id_7"] }));
}

function handle_exp_response(event) {
  var jsonData = JSON.parse(event.data);

  //ignore heartbeat messages
  if (jsonData.type == "heartbeat") {
    return
  }
  else if (jsonData.type == "serviceMessage") {
    var payload = jsonData.payload;
    //count all entries with the incoming ID
    con.query("SELECT COUNT(id) FROM characters WHERE id =" + payload.character_id , function (err, result) {
      if (err) throw err;
      //console.log(result[0]["COUNT(id)"])
      //result is a array of objects, so this ensues
      if (result[0]["COUNT(id)"]==0) {
        //character does not exist so we create it
        create_character(payload.character_id);
      }
    })
    //actually increase the resurrections count
    var sql = "UPDATE characters SET resurrections = IFNULL(resurrections, 0) + 1 WHERE id = "+ payload.character_id +";";
    con.query(sql, function (err, result) {
      if (err) throw err;
    })
  }
}

//duplicate safe function to create a character entry from their id
function create_character(id){
  //request username
  var requestString = "http://census.daybreakgames.com/"+ serviceID +"/get/ps2:v2/character/?character_id=" + id + "&c:show=name";
  fetch(requestString).then( function (result) {
    result.json().then(function (jsonData) {
      //console.log(jsonData)
      //for some reason this is the best way to do duplicate safe insertion
      var sql = "INSERT INTO characters(id, username) VALUES (" + id + ",'" + jsonData.character_list[0].name.first +"') ON DUPLICATE KEY UPDATE id=id;";
      con.query(sql, function (err, result) {
        if (err) throw err;
      })
    })
  });
}

function call_api(request,response){
  var i=request.url.indexOf("api")+4
  fetch("http://census.daybreakgames.com/s:jtwebtech/" + request.url.slice(i)).then(handle);
  function handle(apiresponse) {
    apiresponse.text().then( (text) => reply(response, text, mime.contentType(".json")));  
  }
}

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

function handle_get(request, response, params) {
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
    //reflect request on to the daybreak API
    else if (request.url.startsWith("/api/")){
      call_api(request,response);
    }
  
    console.log();
    //client has requested the 10 characters with the most resurrections
    if ("res" in params){
      var thing = "SELECT username, resurrections FROM characters ORDER BY resurrections DESC LIMIT 10;";
      con.query(thing, function (err, result) {
        //build a string from the SQL result array
        var content = result.map((x) => "(" + x.username + "," + x.resurrections + ")").join(", ")
        reply(response, content, "text/plain")
        if (err) throw err;
      });
    }
}

function handle_post(request, response, params) {
  var url = request.url;
  if (url == "/fanart") {
    var form = new formidable.IncomingForm();
    form.parse(request, parse_fanart);
    response.writeHead(204);
    response.end();
  }
}

function parse_fanart(err, fields, files) {
  if (err) throw err;
  console.log("Files uploaded " + JSON.stringify(files));
  fs.rename(files.filename.path, __dirname + path.sep + "Fanart" + path.sep + files.filename.name, (err) => {if (err) throw err;});
}

//we may use this one day
//C# has this as an operator nehhh
function isnull(a,b){
  if (a==null){
    return b;
  }
  return a;
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
  var content = await FS.readFileSync("./" + filePath, "utf8");
  var templateMap = {};
  //here we add stuff to the template map to be sent to the client
  if (filePath == "index.html") {
    var time = (new Date()).toDateString();
    templateMap["time"] = time;
  }
  else if (filePath == "fanart.html") {
    templateMap["images"] = fanart;
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
        var key = content.substring(i + 1, end)
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
        //console.log("entering loop");
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
    content = await FS.readFileSync("./" + filePath, "utf8");
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