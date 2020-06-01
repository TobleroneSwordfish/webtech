const bcrypt = require("bcrypt")
const saltRounds = 10;
var query;
// exports.test1 = 
// function test1() {
//     console.log("hai")
// }
exports.setQueryMethod = method => query = method;

exports.createUser = async function(username, password) {
    hash = await bcrypt.hashSync(password, saltRounds);
    var q = "INSERT INTO users (username, password_hash) VALUES ('" + username + "', '" + hash + "');";
    var resp = await query(q);
}

exports.authenticateUser = async function(username, password) {
    var q = "SELECT password_hash FROM users WHERE username = '" + username + "';";
    var resp = await query(q);
    if (resp.length > 0) {
        var result = await bcrypt.compareSync(password, resp[0].password_hash);
        return result;
    }
    return false;
}

//delets the user only if we can authenticate them
exports.deleteUser = async function(username, password) {
    var allowed = await exports.authenticateUser(username, password)
    if (allowed) {
        var q = "DELETE FROM users WHERE username = '" + username + "');";
        query(q);
        return true;
    }
    return false;
}