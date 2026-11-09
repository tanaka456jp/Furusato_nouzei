"use strict";

// Synthetic API contract data. The owner tool separately attests real v0.1.20
// source bytes against the Git commit recorded in the private receipt.
module.exports=require("../../deployment/private-gas.cjs").source().map(file=>
 file.name==="Engine"?{...file,source:'var VERSION = "gas-mvp-0.1.20";'}:file);
