"use strict"
const bcrypt = require("bcrypt")
const saltRounds = 10;
var query;

exports.setQueryMethod = method => query = method;

exports.createUser = async function(username, password, admin) {
    if (admin == undefined) {
        admin = false;
    }
    var hash = await bcrypt.hashSync(password, saltRounds);
    var q = "INSERT INTO users (username, password_hash, admin) VALUES ('" + username + "', '" + hash + "', " + admin + ") ON DUPLICATE KEY UPDATE admin=" + admin + ";";
    var resp = await query(q);
}

exports.authenticateUser = async function(username, password) {
    var q = "SELECT password_hash, admin FROM users WHERE username = '" + username + "';";
    var resp = await query(q);
    if (resp.length > 0) {
        var result = await bcrypt.compareSync(password, resp[0].password_hash);
        if (result && resp[0].admin) {
            return "admin";
        }
        return result;
    }
    return false;
}

//delets the user only if we can authenticate the admin trying to delete it
exports.deleteUser = async function(adminUser, adminPass, usernameToDelete) {
    var allowed = await exports.authenticateUser(adminUser, adminPass)
    if (allowed) {
        var q = "DELETE FROM users WHERE username = ?;";
        await query(q, [usernameToDelete]);
        return true;
    }
    return false;
}