import {createHash,X509Certificate} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const expectedDerSha256='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
export const certificatePath=resolve(dirname(fileURLToPath(import.meta.url)),'../certs/prod-ca-2021.crt');
export function verifySupabaseCertificate(path=certificatePath){
 const certificate=new X509Certificate(readFileSync(path));
 const fingerprint=createHash('sha256').update(certificate.raw).digest('hex');
 if(fingerprint!==expectedDerSha256||certificate.ca!==true||Date.parse(certificate.validTo)<=Date.now())throw new Error('Supabase CA certificate identity mismatch');
 return path;
}
