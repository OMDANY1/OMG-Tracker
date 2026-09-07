import {runtime,migrations,root} from './runtime.mjs';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const db=await runtime();
try {
  await migrations(db);
  const {rows}=await db.query(`SELECT p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result,
    has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') AS service_role_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef ORDER BY p.proname`);
  await writeFile(resolve(root,'RPC_CONTRACT.json'),JSON.stringify(rows,null,2)+'\n');
  console.log(`${rows.length} public RPC contracts exported from PostgreSQL catalog`);
} finally {await db.close();}
