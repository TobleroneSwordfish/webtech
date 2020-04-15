"use strict"
let HTTP = require('http');
let FS = require("fs");
let mime = require("mime-types");
let mysql = require("mysql");
let fetch = require("node-fetch");
let yaml = require('js-yaml');
let fs   = require('fs');
const WebSocket = require('ws');


var con;

var serviceID = "s:jtwebtech"

start_server(8080);
connect_db(read_yaml());
request_exp();

var pageMap = {
  "/":"index.html",
  "/test":"test.txt",
  "/style.css":"style.css",
  "/VSlogo.svg":"aliens.svg",
  "/TRlogo.svg":"sword.svg",
  "/NClogo.svg":"murica.svg"
}

// Provide a service to localhost only.
function start_server(port) {
  let service = HTTP.createServer(handle);
  service.listen(port, 'localhost');
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
  socket.onopen = () => start(socket);
  
}

function handle_exp_response(event) {
  var jsonData = JSON.parse(event.data);
  // console.log(jsonData);
  //ignore heartbeat messages
  if (jsonData.type == "heartbeat") {
    return
  }
  else if (jsonData.type == "serviceMessage") {
    con.query("SELECT COUNT(id) FROM characters WHERE id =" + jsonData.payload.character_id , function (err, result) {
      if (err) throw err;
      console.log(result[0]["COUNT(id)"])
      if (result[0]["COUNT(id)"]==0) {
        console.log("JS sucks")
        create_character(jsonData.payload.character_id);
      }
    })
    var sql = "UPDATE characters SET resurrections = IFNULL(resurrections, 0) + 1 WHERE id = "+ jsonData.payload.character_id +";";
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
      console.log(jsonData)
      var sql = "INSERT INTO characters(id, username) VALUES (" + id + ",'" + jsonData.character_list[0].name.first +"') ON DUPLICATE KEY UPDATE id=id;";
      con.query(sql, function (err, result) {
        if (err) throw err;
      })
    })
  });
}

function start(socket) {
  socket.send(JSON.stringify({ "service": "event", "action": "subscribe", "characters": ["all"], "eventNames": ["GainExperience_experience_id_7"] }));
}

function read_yaml() {
  try {
    var doc = yaml.safeLoad(fs.readFileSync('properties.yaml', 'utf8'));
  } catch (e) {
    console.log(e);
  }
  return doc
}

function callapi(request,response){
  var i=request.url.indexOf("api")+4
  fetch("http://census.daybreakgames.com/s:jtwebtech/" + request.url.slice(i)).then(handle);
  function handle(apiresponse) {
    apiresponse.text().then( (text) => reply(response, text, mime.contentType(".json")));  
  }
}

// Deal with a request.
function handle(request, response) {
  var params = parseparameters(request.url);
  console.log("Method:", request.method);
  console.log("URL:", request.url);
  //console.log("Headers:", request.headers);

  var file = pageMap[request.url];
  console.log("Filename found: " + file);
  if (file) {
    var type = mime.contentType(file);
    console.log("Content-Type: " + type);
    if (type.includes("text/html")) {
      sendPage(file, response);
    }
    else {
      sendFile(file, response, type);
    }
  }
  else if (request.url.startsWith("/api/")){
    callapi(request,response);
  }
  console.log();
  console.log(params)
  if ("res" in params){
    console.log("print")
    var thing = "SELECT username FROM characters ORDER BY resurrections DESC LIMIT 10;";
    con.query(thing, function (err, result) {
      var content = result.map((x) => x.username).join()
      reply(response, content, "text/plain")
      if (err) throw err;
    });
  }
}

function isnull(a,b){
  if (a==null){
    return b;
  }
  return a;
}

function parseparameters(url){
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

async function sendPage(filePath, response) {
  var content = await FS.readFileSync("./" + filePath, "utf8");
  var templateMap = {};
  if (filePath == "index.html") {
    var time = (new Date()).toDateString();
    templateMap["time"] = time;
  }
  content = template(content, templateMap);
  // console.log("Content: " + content);
  reply(response, content, 'text/html');
}

//takes the page content string and a map of variable names to values
//returns the same content with the names changed to values
function template(content, templateMap) {
  var i = content.indexOf("${");
  while(i != -1) {
    var end = content.indexOf("}", i);
    if (end != -1) {
      var key = content.substring(i + 2, end)
      if (templateMap[key]) {
        content = content.split("${" + key + "}").join(templateMap[key]);
      }
    }
    else {
      break;
    }
    i = content.indexOf("${");
  }
  return content;
}

async function sendFile(filePath, response, mimeType) {
  var content = await FS.readFileSync("./" + filePath, "utf8");
  reply(response, content, mimeType);
}


// Send a reply.
function reply(response, content, mimeType) {
  let hdrs = { 'Content-Type': mimeType };
  response.writeHead(200, hdrs);  // 200 = SNAZZY
  response.write(content);
  response.end();
}