import {runtime,migrations} from './runtime.mjs';
const db=await runtime();
console.log((await db.query('SELECT version()')).rows[0].version);
try { await migrations(db, process.argv[2] || 'migrations'); }
catch(e) {console.error(JSON.stringify({code:e.code,message:e.message,detail:e.detail,where:e.where,position:e.position}));process.exitCode=1;}
finally {await db.close();}
