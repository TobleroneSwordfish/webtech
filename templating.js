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
                    content = content.split("${" + key + "}").join(template(templateMap[key], templateMap));
                }
                else {
                    console.log("Missing object in template map: " + key);
                    break;
                }
            }
            else {
                console.log("Missing }");
                break;
            }
        }
        //foreach substitution
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
            if (array == undefined) {
                console.log("Missing iterable for foreach templating");
                break;
            }
            //console.log("array = " + array);
            var end = find_end(content, "{}", bracketEnd + 1);
            if (end == -1) {
                console.log("malformed foreach templating at " + i);
                break;
            }
            //values are shifted to negate the ){ at the start and the } at the end
            var body = content.substring(bracketEnd + 2, end - 1);
            //console.log("body: " + body);
            let newContent = "";
            array.forEach(function(value, index, array) {
                //recurse down to template the body
                var localMap = {};
                localMap[keyName] = value;
                var block = template(body, {...localMap, ...templateMap});
                //console.log("block = " + block);
                newContent = newContent.concat(block);
            });
            //console.log("new content = " + newContent);
            //replace the template with the templated blocks
            content = content.substring(0, i - 1) + newContent + content.substring(end + "}".length);
        }
        else if (content.substring(i).startsWith("if(")) {
            var bracketEnd = content.indexOf(")", i);
            if (bracketEnd == -1) {
                console.log("Missing ) to match if( at " + i);
                break;
            }
            var boolName = content.substring(i + "if(".length, bracketEnd);
            // if (templateMap[boolName] == undefined) {
            //     console.log("Missing boolean to satisfy if at " + i);
            // }
            var bodyEnd = find_end(content, "{}", bracketEnd + 1);
            var body = content.substring(bracketEnd + 2, bodyEnd - 1);
            //there is an else case
            var elseCase = false;
            if (content.substring(bodyEnd).startsWith("else")) {
                elseCase = true;
                var elseStart = bodyEnd + "else".length;
                var elseEnd = find_end(content, "{}", elseStart);
                var elseBody = content.substring(elseStart + 1, elseEnd - 1);
                bodyEnd = elseEnd;
                if (!templateMap[boolName]) {
                    content = content.substring(0, i - 1) + template(elseBody, templateMap) + content.substring(bodyEnd + 1);
                }
            }
            if (templateMap[boolName]) {
                content = content.substring(0, i - 1) + template(body, templateMap) + content.substring(bodyEnd + 1);
            }
            else if (!elseCase) {
                content = content.substring(0, i - 1) + content.substring(bodyEnd + 1);
            }
        }
        else {
            console.log("lone $ found in templating");
            break;
        }
        i = content.indexOf("$");
    }
    // console.log(content);
    return content;
}
exports.template = template;

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

function simple_template() {

}