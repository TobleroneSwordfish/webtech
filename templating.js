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
        //basic substitution
        i++;
        if (content[i] == '{') {
            var end = content.indexOf("}", i);
            if (end != -1) {
                var key = content.substring(i + 1, end);
                var value = evaluate(key, templateMap);
                if (value) {
                    content = content.split("${" + key + "}").join(template(value, templateMap));
                }
                else {
                    console.log("Missing object in template map: " + key);
                    break;
                }
            }
            else {
                console.log("Missing } to match { at " + i);
                break;
            }
        }
        else {
            var bracketStart = content.indexOf("(", i);
            var bracketEnd = content.indexOf(")", i);
            if (bracketEnd == -1 || bracketEnd == -1) {
                console.log("malformed foreach templating at " + i);
                break;
            }
            var keyword = content.substring(i, bracketStart);
            var arguments = content.substring(bracketStart + 1, bracketEnd);
            switch (keyword) {
                case "foreach":
                    content = template_foreach(arguments, content, templateMap, i, bracketEnd + 1);
                    break;
                case "if":
                    content = template_if(arguments, content, templateMap, i, bracketEnd + 1);
                    break;
                case "declare":
                    var values = template_declare(arguments, content, templateMap, i, bracketEnd + 1);
                    content = values[0];
                    templateMap = { ...templateMap, ...values[1]};
                    break;
                default:
                    console.log("lone $ found in templating");
                    break;
            }
        }
        i = content.indexOf("$");
    }
    return returnMap ? templateMap : content;
}

function external_template(content, templateMap) {
    return template(content, templateMap);
}
exports.template = external_template;

function template_if(arguments, content, templateMap, i, blockStart) {
    var bodyEnd = find_end(content, "{}", blockStart);
    var body = content.substring(blockStart + 1, bodyEnd - 1);
    var value = evaluate(arguments, templateMap);
    //there is an else case
    var elseCase = false;
    if (content.substring(bodyEnd).startsWith("else")) {
        elseCase = true;
        var elseStart = bodyEnd + "else".length;
        var elseEnd = find_end(content, "{}", elseStart);
        var elseBody = content.substring(elseStart + 1, elseEnd - 1);
        bodyEnd = elseEnd;
        if (!value) {
            content = content.substring(0, i - 1) + template(elseBody, templateMap) + content.substring(bodyEnd + 1);
        }
    }
    if (value) {
        content = content.substring(0, i - 1) + template(body, templateMap) + content.substring(bodyEnd + 1);
    }
    else if (!elseCase) {
        content = content.substring(0, i - 1) + content.substring(bodyEnd + 1);
    }
    return content;
}

function template_foreach(arguments, content, templateMap, i, blockStart) {
    var inside = arguments.split(" in ");
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
        var block = template(body, fullTemplate);
        //console.log("block = " + block);
        newContent = newContent.concat(block);
    });
    //console.log("new content = " + newContent);
    //replace the template with the templated blocks
    return content.substring(0, i - 1) + newContent + content.substring(end + "}".length);
}

function template_declare(arguments, content, templateMap, i, blockStart) {
    var blockEnd = find_end(content, "{}", blockStart);
    var block = content.substring(blockStart + 1, blockEnd - 1);
    var newTemplate = {};
    newTemplate[arguments] = block;
    content = content.substring(0, i - 1) + content.substring(blockEnd + 1);
    return [content, newTemplate];
}

function find_end(content, symbolPair, i) {
    if (content[i] != symbolPair[0]) {
        return -1;
    }
    i++;
    var bracketCount = 0;
    while (bracketCount >= 0) {
        if (i == content.length) {
            return -1
        }
        if (content[i] == symbolPair[0]) {
            bracketCount++;
        }
        else if (content[i] == symbolPair[1]) {
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