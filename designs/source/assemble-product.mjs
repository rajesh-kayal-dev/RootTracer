import {readFileSync,writeFileSync} from 'node:fs';
const base=new URL('./',import.meta.url);
let source=readFileSync(new URL('build-roottracer-product.mjs',base),'utf8');
source=source.replace('txt(String(83+i)','txt(String((title.startsWith(\'src/jobs\')?83:1)+i)');
source+='\n'+readFileSync(new URL('roottracer-product-part2.js',base),'utf8');
writeFileSync(new URL('run-product-build.mjs',base),source);
await import('./run-product-build.mjs?build='+Date.now());
