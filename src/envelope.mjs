import {constants,createCipheriv,createDecipheriv,createHash,createPrivateKey,createPublicKey,privateDecrypt,publicEncrypt,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,renameSync,statSync,unlinkSync} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const MAGIC=Buffer.from('CAKRAENC2');
const IV_BYTES=12;
const TAG_BYTES=16;

export async function encryptStream(source,publicKeyPem,outputPath){
 const recipient=createPublicKey(publicKeyPem);
 if(recipient.asymmetricKeyType!=='rsa'||(recipient.asymmetricKeyDetails?.modulusLength??0)<3072)throw new Error('RSA-3072 or stronger recipient required');
 if(existsSync(outputPath)||existsSync(`${outputPath}.part`))throw new Error('Archive output already exists');
 const dataKey=randomBytes(32),iv=randomBytes(IV_BYTES);
 const wrapped=publicEncrypt({key:recipient,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},dataKey);
 const size=Buffer.alloc(2);size.writeUInt16BE(wrapped.length);
 const header=Buffer.concat([MAGIC,size,iv,wrapped]);
 const plainHash=createHash('sha256');let plainBytes=0;
 const meter=new Transform({transform(chunk,_encoding,callback){plainHash.update(chunk);plainBytes+=chunk.length;callback(null,chunk);}});
 const cipher=createCipheriv('aes-256-gcm',dataKey,iv);
 const temp=`${outputPath}.part`,out=createWriteStream(temp,{flags:'wx',mode:0o600});
 try{
  out.write(header);
  await pipeline(source,meter,cipher,out,{end:false});
  out.end(cipher.getAuthTag());
  await new Promise((resolve,reject)=>{out.once('finish',resolve);out.once('error',reject);});
  renameSync(temp,outputPath);
  const encryptedHash=createHash('sha256');
  for await(const chunk of createReadStream(outputPath))encryptedHash.update(chunk);
  return {format:'cakra-envelope-v2',algorithm:'RSA-OAEP-SHA256+A256GCM',plainSha256:plainHash.digest('hex'),plainBytes,encryptedSha256:encryptedHash.digest('hex'),encryptedBytes:statSync(outputPath).size};
 }catch(error){out.destroy();try{unlinkSync(temp);}catch{}throw error;}
 finally{dataKey.fill(0);}
}

// Used only for disposable synthetic acceptance and owner-controlled recovery.
export function decryptBuffer(encrypted,privateKeyPem){
 if(!Buffer.isBuffer(encrypted)||!encrypted.subarray(0,MAGIC.length).equals(MAGIC))throw new Error('Unsupported encrypted archive');
 const wrappedBytes=encrypted.readUInt16BE(MAGIC.length);
 const ivStart=MAGIC.length+2,wrappedStart=ivStart+IV_BYTES,payloadStart=wrappedStart+wrappedBytes;
 if(wrappedBytes<384||wrappedBytes>1024||encrypted.length<payloadStart+TAG_BYTES)throw new Error('Truncated encrypted archive');
 const dataKey=privateDecrypt({key:createPrivateKey(privateKeyPem),oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},encrypted.subarray(wrappedStart,payloadStart));
 try{
  const decipher=createDecipheriv('aes-256-gcm',dataKey,encrypted.subarray(ivStart,wrappedStart));
  decipher.setAuthTag(encrypted.subarray(-TAG_BYTES));
  return Buffer.concat([decipher.update(encrypted.subarray(payloadStart,-TAG_BYTES)),decipher.final()]);
 }finally{dataKey.fill(0);}
}
