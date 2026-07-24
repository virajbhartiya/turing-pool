// Stamp deployed addresses + start block into subgraph.yaml.
// Usage: node configure.mjs <appAddress> <aquaAddress> [startBlock] [network]
import { readFileSync, writeFileSync } from 'node:fs';

const [app, aqua, startBlock = '0', network = 'base'] = process.argv.slice(2);
if (!app) {
  console.error('usage: node configure.mjs <appAddress> [aquaAddress] [startBlock] [network]');
  process.exit(1);
}
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
if (!addressPattern.test(app) || (aqua && !addressPattern.test(aqua))) {
  console.error('appAddress and aquaAddress must be 20-byte hex addresses');
  process.exit(1);
}
if (!/^\d+$/.test(startBlock)) {
  console.error('startBlock must be a non-negative integer');
  process.exit(1);
}

let yaml = readFileSync('subgraph.yaml', 'utf8');
yaml = yaml.replace(
  /(name: TuringPoolApp[\s\S]*?source:\s*\n\s*address: )"[^"]+"/,
  `$1"${app}"`,
);
yaml = yaml.replace(
  /(appAddress:\s*\n\s*type: Bytes\s*\n\s*data: )"[^"]+"/,
  `$1"${app}"`,
);
if (aqua) {
  yaml = yaml.replace(
    /(name: Aqua[\s\S]*?source:\s*\n\s*address: )"[^"]+"/,
    `$1"${aqua}"`,
  );
}
yaml = yaml.replaceAll(/startBlock: \d+/g, `startBlock: ${startBlock}`);
yaml = yaml.replaceAll(/network: [\w-]+/g, `network: ${network}`);
writeFileSync('subgraph.yaml', yaml);
console.log(`configured subgraph: app=${app} aqua=${aqua ?? 'unchanged'} startBlock=${startBlock} network=${network}`);
