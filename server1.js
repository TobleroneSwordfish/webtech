"use strict"
let HTTP = require('http');
let FS = require("fs");
let mime = require("mime-types");
start(8080);

var pageMap = {
  "/":"index.html",
  "/test":"test.txt"
}

// Provide a service to localhost only.
function start(port) {
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
    var type = mime.lookup(file);
    if (type = "text/html") {
      sendPage(file, response);
    }
    else {
      sendFile(file, response, mimeType);
    }
  }
}

async function sendPage(filePath, response) {
  var content = await FS.readFileSync("./" + filePath);
  console.log("Content: " + content);
  reply(response, content, 'text/html');
}

async function sendFile(filePath, response, mimeType) {
  var content = await FS.readFileSync("./" + filePath);
  reply(response, content, mimeType);
}


// Send a reply.
function reply(response, content, mimeType) {
  console.log("Content-Type: " + mimeType);
  let hdrs = { 'Content-Type': mimeType };
  response.writeHead(200, hdrs);  // 200 = OK
  response.write(content);
  response.end();
}


function getFileExtension(filename) {
  return filename.split(".").pop();
}
