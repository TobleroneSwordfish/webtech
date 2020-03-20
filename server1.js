"use strict"
let HTTP = require('http');
let FS = require("fs");
let mime = require("mime-types");
let mysql = require("mysql");
start(8080);

var pageMap = {
  "/":"index.html",
  "/test":"test.txt",
  "/style.css":"style.css"
}

// Provide a service to localhost only.
function start(port) {
  console.log("css mimetype = " + mime.contentType("style.css"));
  let service = HTTP.createServer(handle);
  service.listen(port, 'localhost');
}

// Deal with a request.
function handle(request, response) {
  console.log("Method:", request.method);
  console.log("URL:", request.url);
  console.log("Headers:", request.headers);

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
}

async function sendPage(filePath, response) {
  var content = await FS.readFileSync("./" + filePath, "utf8");
  var templateMap = {};
  if (filePath == "index.html") {
    var time = (new Date()).toDateString();
    templateMap["time"] = time;
  }
  content = template(content, templateMap);
  console.log("Content: " + content);
  reply(response, content, 'text/html');
}

//takes the page content string and a map of variable names to values
//returns the same content with the names changed to values
function template(content, templateMap) {
  var i = content.indexOf("${");
  while(i != -1) {
    var end = content.indexOf("}");
    if (end != -1) {
      var key = content.substring(i + 2, end)
      if (templateMap[key]) {
        content = content.split("${" + key + "}").join(templateMap[key]);
      }
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
  response.writeHead(200, hdrs);  // 200 = OK
  response.write(content);
  response.end();
}