// Stamp deployed addresses + start block into subgraph.yaml.
// Usage: node configure.mjs <appAddress> <aquaAddress> [startBlock] [network]
import { readFileSync, writeFileSync } from 'node:fs';

const [app, aqua, startBlock = '0', network = 'base'] = process.argv.slice(2);
if (!app) {
  console.error('usage: node configure.mjs <appAddress> [aquaAddress] [startBlock] [network]');
  process.exit(1);
}

let yaml = readFileSync('subgraph.yaml', 'utf8');
yaml = yaml.replace(/address: "0x0{40}".*/, `address: "${app}"`);
if (aqua) yaml = yaml.replace(/address: "0x499943E74FB0cE105688beeE8Ef2ABec5D936d31".*/, `address: "${aqua}"`);
yaml = yaml.replaceAll(/startBlock: \d+/g, `startBlock: ${startBlock}`);
yaml = yaml.replaceAll(/network: \w+/g, `network: ${network}`);
writeFileSync('subgraph.yaml', yaml);
console.log(`configured subgraph: app=${app} aqua=${aqua ?? 'unchanged'} startBlock=${startBlock} network=${network}`);
