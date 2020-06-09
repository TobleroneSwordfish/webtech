"use strict"
const vm = require("vm"); //ho boy
const fs = require("fs");

const globalsFile = "./globals.html";
var globalMap = {};
accquireGlobals();

async function accquireGlobals() {
    var content = await fs.readFileSync(globalsFile, "utf8");
    globalMap = template(content, {}, true);
}

//takes the page content string and a map of variable names to values
//returns the same content with the names changed to values

//the last param is optional and excluded from the exported version,
//just makes it return the templateMap instead of the content
//for loading global $declares
function template(content, templateMap, returnMap) {
    if (!returnMap) {
        templateMap = {...globalMap, ...templateMap};
    }
    if (typeof(content) != "string") {
        if (typeof(content) == "number") {
            content = content.toString();
        }
        else {
            console.log("Non string value passed to templating function");
            return;
        }
    }
    var i = content.indexOf("$");
    while(i != -1) {
        i++;
        //escaping with $$
        if (content[i] == "$") {
            // var end = find_end(content, "$${}$$", i - 1);
            // var string = content.substring(i - 1 + 3, end - 1);
            // content = content.substring(0,i - 1) + string + content.substring(end + 2);
            // i += string.length - 1;
        }
        //basic substitution
        else if (content[i] == '{') {
            content = template_substitute(content, templateMap, i)[0];
            content = content.substring(0, i - 1) + content.substring(i);
        }
        else if (content.substring(i).startsWith("escape{")) {
            var bracketStart = i + "escape".length;
            var bracketEnd = find_end(content, "{}", bracketStart);
            var result = template_substitute(content, templateMap, bracketStart);
            var newContent = result[0];
            content = newContent.substring(0,i - 1) + newContent.substring(i + "escape".length);
            i = result[1] - "escape".length;
            // console.log(i);
        }
        else {
            var bracketStart = content.indexOf("(", i);
            var bracketEnd = content.indexOf(")", i);
            if (bracketEnd == -1 || bracketEnd == -1) {
                console.log("malformed templating at " + i);
                break;
            }
            var keyword = content.substring(i, bracketStart);
            var parameters = content.substring(bracketStart + 1, bracketEnd);
            var result = [content, i + 1];
            switch (keyword) {
                case "foreach":
                    result = template_foreach(parameters, content, templateMap, i, bracketEnd + 1);
                    break;
                case "if":
                    result = template_if(parameters, content, templateMap, i, bracketEnd + 1);
                    break;
                case "declare":
                    var values = template_declare(parameters, content, templateMap, i, bracketEnd + 1);
                    result = [values[0], values[1]];
                    templateMap = { ...templateMap, ...values[2]};
                    break;
                default:
                    console.log("lone $ found in templating");
                    break;
            }
            content = result[0];
            i = result[1];
        }
        if (i >= content.length) {
            break;
        }
        i = content.indexOf("$", i);
    }
    return returnMap ? templateMap : content;
}

function external_template(content, templateMap) {
    return template(content, templateMap);
}
exports.template = external_template;

function template_substitute(content, templateMap, i) {
    var end = content.indexOf("}", i);
    if (end != -1) {
        var key = content.substring(i + 1, end);
        var value = evaluate(key, templateMap);
        if (value) {
            content = content.substring(0,i) + value + content.substring(end + 1);
            return [content, i + value.length];
        }
        else {
            console.log("Missing object in template map: " + key);
            return [content, end + 1];
        }
    }
    else {
        console.log("Missing } to match { at " + i);
        return [content, end + 1];
    }
}

function template_if(parameters, content, templateMap, i, blockStart) {
    var bodyEnd = find_end(content, "{}", blockStart);
    var body = content.substring(blockStart + 1, bodyEnd - 1);
    var value = evaluate(parameters, templateMap);
    //there is an else case
    var elseCase = false;
    if (content.substring(bodyEnd).startsWith("else")) {
        elseCase = true;
        var elseStart = bodyEnd + "else".length;
        var elseEnd = find_end(content, "{}", elseStart);
        var elseBody = content.substring(elseStart + 1, elseEnd - 1);
        bodyEnd = elseEnd;
        if (!value) {
            var bodyResult = template(body, templateMap);
            content = content.substring(0, i - 1) + bodyResult + content.substring(bodyEnd + 1);
            return [content, i + bodyResult.length]
        }
    }
    if (value) {
        var bodyResult = template(body, templateMap);
        content = content.substring(0, i - 1) + bodyResult + content.substring(bodyEnd + 1);
        return [content, i + bodyResult.length]
    }
    else if (!elseCase) {
        content = content.substring(0, i - 1) + content.substring(bodyEnd + 1);
        return [content, i];
    }
}

function template_foreach(parameters, content, templateMap, i, blockStart) {
    var inside = parameters.split(" in ");
    var keyName = inside[0];
    //console.log("key name = " + keyName);
    // var array = templateMap[inside[1]];
    var array = evaluate(inside[1], templateMap);
    if (array == undefined) {
        console.log("Missing iterable for foreach templating");
        return content;
    }
    //console.log("array = " + array);
    var end = find_end(content, "{}", blockStart);
    if (end == -1) {
        console.log("malformed foreach templating at " + i);
        return content;
    }
    //values are shifted to negate the ){ at the start and the } at the end
    var body = content.substring(blockStart + 1, end - 1);
    //console.log("body: " + body);
    let newContent = "";
    array.forEach(function(value, index, array) {
        //recurse down to template the body
        var localMap = {};
        localMap[keyName] = value;
        var fullTemplate = {...templateMap, ...localMap}
        var block = template(body, fullTemplate)
        //console.log("block = " + block);
        newContent = newContent.concat(block);
    });
    //console.log("new content = " + newContent);
    //replace the template with the templated blocks
    content = content.substring(0, i - 1) + newContent + content.substring(end + "}".length);
    return [content, i + newContent.length];
}

function template_declare(parameters, content, templateMap, i, blockStart) {
    var blockEnd = find_end(content, "{}", blockStart);
    var block = content.substring(blockStart + 1, blockEnd - 1);
    var newTemplate = {};
    newTemplate[parameters] = block;
    content = content.substring(0, i - 1) + content.substring(blockEnd + 1);
    return [content,i, newTemplate];
}

function find_end(content, symbolPair, i) {
    symbolPair = [symbolPair.substring(0,symbolPair.length / 2), symbolPair.substring(symbolPair.length / 2)]
    if (!content.substring(i).startsWith(symbolPair[0])) {
        return -1;
    }
    i+= symbolPair[0].length;
    var bracketCount = 0;
    while (bracketCount >= 0) {
        if (i == content.length) {
            return -1
        }
        if (content.substring(i).startsWith(symbolPair[0])) {
            bracketCount++;
        }
        else if (content.substring(i).startsWith(symbolPair[1])) {
            bracketCount--;
        }
        i++;
    }
    return i;
}

function evaluate(code, templateMap) {
    try {
        var context = new vm.createContext(templateMap);
        var script = new vm.Script(code);
        return script.runInContext(context);
    }
    catch (err) {
        console.log("Error evaluating expression: " + code);
        return;
    }
}