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
                else {
                    log("Missing object in template map: " + key);
                    break;
                }
            }
            else {
                log("Missing }");
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
        if (content[i] == symbolPair[0]) {
            bracketCount++;
        }
        else if (content[i] == symbolPair[1]) {
            bracketCount--;
        }
        i++;
        if (i == content.length) {
            return -1
        }
    }
    return i;
}

function simple_template() {

}