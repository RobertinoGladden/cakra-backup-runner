import {createHash,timingSafeEqual} from 'node:crypto';

const value=process.env.BOUNDARY_SENTINEL??'';
const expected=process.env.BOUNDARY_SENTINEL_SHA256??'';
if(!value||!/^([a-f0-9]{64})$/.test(expected))throw new Error('Boundary probe configuration missing');
const actual=createHash('sha256').update(value).digest();
if(!timingSafeEqual(actual,Buffer.from(expected,'hex')))throw new Error('Boundary probe secret mismatch');
process.stdout.write('PASS: isolated synthetic environment secret matched its digest.\n');
