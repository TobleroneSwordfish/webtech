let mysql = require("mysql");
let util = require('util');
"use strict"

var query;
exports.setQueryMethod = method => query = method;

async function INSERT(table,colnames,values,ignore){
    if (ignore==undefined){
        ignore=false;
    }
    var q="INSERT ";
    if (ignore){
        q+="IGNORE ";
    }
    q+="INTO ";
    q+=table;
    q+=" (";
    var vs="(";
    for (var i=0; i < values.length; i++){
        q+=colnames[i];
        q+=", ";
        vs+="?,"
    }
    q=q.slice(0, -2);
    vs=vs.slice(0,-1)
    vs+=");"
    q+=") VALUES ";
    q+=vs
    // console.log(q)
    await query(q, values);
}

async function DELETE(table,colnames,values, connectives){
    var q="DELETE FROM "
    q+=table
    q+=" WHERE "
    for (var i=0;i<values.length;i++){
        q+=colnames[i]
        q+=" = ?"
        if (i<values.length-1){
            q+=" "+connectives[i]+" "
        }
        else{
            q+=";"
        }
    }
    console.log(q)
    await query(q, values);
}

async function UPDATE(table,colnames,values){
    q="UPDATE ";
    q+= table;
    q+=" SET ";
    q+= colnames[0];
    q+=" = ";
    if (values.length==2){
        q+=" ? WHERE ";
    }
    else {
        q+="IFNULL(";
        q+=colnames[0];
        q+=", 0) + 1 WHERE "
    }
    q+=colnames[1];
    q+=" = ?;";
    await query(q, values);
}

async function SELECT(table, colnames, as, where, connectives, order,limit,lastinserted){
    q="SELECT ";
    if (lastinserted){
        q+="LAST_INSERT_ID()";
    }
    else {
        for (var i=0;i<colnames.length;i++){
            q+=colnames[i];
            if (as.findIndex((element) => element == colnames[i])!=-1){
                q+=" AS ";
                q+=as[as.findIndex((element) => element == colnames[i])+1];
            }
            q+=", "
        }
        q=q.slice(0,-2);
        q+=" FROM ";
        q+=table;
        var args=[];
        if (where.length!=0){
            for (var i=0;i<where.length;i++){
                q+=" WHERE ";
                q+=where[i][0];
                if (where[i][1]!="NULL"){
                    args.push(where[i][1]);
                    if (where[i][1].length>1){
                        q+= " in (?)";
                    }
                    else{
                        q+=" = ?";
                    }
                    if (i<where.length-1){
                        q+=" "+connectives[i]+" "
                    }
                }
                else{
                    q+=" IS NULL";
                }
            }
        }
        if (order.length!=0){
            q+=" ORDER BY ";
            q+=order[0]+" ";
            q+=order[1];
        }
        if (limit!=0){
            q+=" LIMIT ";
            q+=limit;
        }
    }
    q+=";";
    console.log(q)
    var result = await query(q,args);
    return result;
}

exports.INSERT = INSERT;
exports.DELETE = DELETE;
exports.UPDATE = UPDATE;
exports.SELECT = SELECT;