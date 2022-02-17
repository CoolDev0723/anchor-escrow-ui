const fs = require('fs');
const project_name = 'anchor_escrow';
const idl = require(`./target/idl/${project_name}.json`);

// fs.writeFileSync('./app/src/idl.json', JSON.stringify(idl));
fs.writeFileSync('./app/src/idl.json', JSON.stringify(idl, null, 2));