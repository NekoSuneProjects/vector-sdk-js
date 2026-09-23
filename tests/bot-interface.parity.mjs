// Parity check: the TS port of vector_core::bot_interface against the Rust
// crate's own test vectors (crates/vector-core/src/bot_interface.rs, mod tests).
import assert from 'node:assert/strict';
import {
  addressedBots,
  commandText,
  manifestFromEvent,
  manifestToEvent,
  MAX_BOT_TAGS,
  parseCommandText,
  typedArgs,
  usageLine,
  validateManifest,
} from '../dist/bot-interface.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    console.log(`  FAIL ${name}\n       ${error.message}`);
    process.exitCode = 1;
  }
};

const priceManifest = () => ({
  v: 1,
  commands: [
    {
      name: 'price',
      description: 'Price of an asset',
      args: [
        { name: 'asset', type: 'choice', description: 'Which asset', required: true, choices: ['btc', 'xmr', 'pivx'] },
      ],
    },
    {
      name: 'say',
      description: 'Say something N times',
      args: [
        { name: 'count', type: 'int', description: 'How many', required: true },
        { name: 'text', type: 'string', description: 'What to say', required: true },
      ],
    },
  ],
});

const announceManifest = () => ({
  v: 1,
  commands: [
    {
      name: 'announce',
      description: 'Announce something',
      args: [
        { name: 'title', type: 'string', description: 't', required: true },
        { name: 'body', type: 'string', description: 'b', required: true },
      ],
    },
  ],
});

console.log('\nbot_interface parity');

test('manifest round-trips through its event', () => {
  const sk = generateSecretKey();
  const event = manifestToEvent(priceManifest(), sk);
  assert.equal(event.kind, 10304);
  const back = manifestFromEvent(event);
  assert.equal(back.commands.length, 2);
  assert.equal(back.commands.find((c) => c.name === 'price').args[0].choices.length, 3);
});

test('an empty token skips an optional arg so later ones are reachable', () => {
  const m = {
    v: 1,
    commands: [
      {
        name: 'listings',
        description: 'l',
        args: [
          { name: 'category', type: 'string', description: 'c', required: false },
          { name: 'page', type: 'int', description: 'p', required: false },
        ],
      },
    ],
  };
  const parsed = parseCommandText(m, '/listings "" 2');
  assert.deepEqual(parsed.args, [['page', '2']], 'the hole never becomes an argument');
  const typed = typedArgs(m.commands[0], parsed);
  assert.ok(!typed.has('category'));
  assert.equal(typed.get('page').value, 2);

  // An empty REQUIRED token still binds, and fails typing rather than vanishing.
  const pm = priceManifest();
  const p2 = parseCommandText(pm, '/say "" hello');
  assert.equal(p2.args.length, 2, 'an empty required token still binds');
  assert.throws(() => typedArgs(pm.commands[1], p2));
});

test('a quoted command word is ordinary chat', () => {
  const m = priceManifest();
  assert.equal(parseCommandText(m, '/"price" btc'), null);
  assert.equal(parseCommandText(m, '/"" btc'), null);
  assert.notEqual(parseCommandText(m, '/price btc'), null);
});

test('the command word is case folded', () => {
  const m = priceManifest();
  const p = parseCommandText(m, '/PRICE btc');
  assert.equal(p.name, 'price');
  assert.deepEqual(p.args, [['asset', 'btc']]);

  const p2 = parseCommandText(m, '/Say 2 Hello There');
  assert.equal(p2.name, 'say');
  assert.deepEqual(p2.args[1], ['text', 'Hello There']);
});

test('user args accept the NIP-21 URI and normalize to a bare npub', () => {
  const npub = nip19.npubEncode(getPublicKey(generateSecretKey()));
  const spec = {
    name: 'greet',
    description: 'g',
    args: [{ name: 'who', type: 'user', description: 'w', required: true }],
  };
  const m = { v: 1, commands: [spec] };

  assert.equal(typedArgs(spec, parseCommandText(m, `/greet ${npub}`)).get('who').value, npub);
  assert.equal(typedArgs(spec, parseCommandText(m, `/greet nostr:${npub}`)).get('who').value, npub);
  assert.throws(() => typedArgs(spec, parseCommandText(m, '/greet npub1nope')));
});

test('typing errors are canonical and parsable', () => {
  const m = priceManifest();
  const price = m.commands[0];
  const say = m.commands[1];

  assert.throws(() => typedArgs(price, parseCommandText(m, '/price doge')), {
    message: 'asset: not one of btc, xmr, pivx',
  });
  assert.throws(() => typedArgs(price, parseCommandText(m, '/price')), {
    message: 'asset: required',
  });
  assert.throws(() => typedArgs(say, parseCommandText(m, '/say notanint hi')), {
    message: 'count: not an integer',
  });
});

test('validation rejects the sharp edges', () => {
  assert.ok(validateManifest({ v: 2, commands: [] }), 'unsupported version');
  assert.ok(
    validateManifest({
      v: 1,
      commands: [
        { name: 'dup', description: 'a' },
        { name: 'dup', description: 'b' },
      ],
    }),
    'duplicate command name',
  );
  assert.ok(
    validateManifest({
      v: 1,
      commands: [{ name: 'c', description: 'd', args: [{ name: 'a', type: 'choice', required: true }] }],
    }),
    'choice without choices',
  );
  assert.ok(
    validateManifest({
      v: 1,
      commands: [
        {
          name: 'c',
          description: 'd',
          args: [
            { name: 'a', type: 'string', required: false },
            { name: 'b', type: 'string', required: true },
          ],
        },
      ],
    }),
    'required arg after an optional one',
  );
  assert.equal(validateManifest(priceManifest()), null, 'a sound manifest validates');
});

test('command_text and parse are inverses', () => {
  const m = priceManifest();
  const args = [['asset', 'btc']];
  const content = commandText('price', args);
  assert.equal(content, '/price btc');
  const p = parseCommandText(m, content);
  assert.equal(p.name, 'price');
  assert.deepEqual(p.args, args);

  // Nasty values must survive the wire byte-exact.
  const am = announceManifest();
  for (const nasty of ['hello world', 'quote " inside', 'back\\slash', 'trailing space ', 'a  b']) {
    const pairs = [
      ['title', nasty],
      ['body', 'tail'],
    ];
    const text = commandText('announce', pairs);
    const parsed = parseCommandText(am, text);
    assert.deepEqual(parsed.args, pairs, `value must survive the wire byte-exact: ${JSON.stringify(nasty)}`);
  }
});

test('text parses positionally and greedily', () => {
  const m = priceManifest();
  assert.deepEqual(parseCommandText(m, '/price btc').args, [['asset', 'btc']]);

  const p = parseCommandText(m, '/say 3 hello  there world');
  assert.deepEqual(p.args[0], ['count', '3']);
  assert.deepEqual(p.args[1], ['text', 'hello  there world'], 'the greedy tail preserves inner spacing');

  assert.equal(parseCommandText(m, '/unknown x'), null);
  assert.equal(parseCommandText(m, 'not a command'), null);
  assert.equal(parseCommandText(m, '/'), null);
});

test('bot recipient tags extract, dedup and cap', () => {
  const a = getPublicKey(generateSecretKey());
  const b = getPublicKey(generateSecretKey());
  const out = addressedBots([
    ['bot', a],
    ['bot', b],
    ['bot', a], // duplicate
    ['bot', 'not-a-pubkey'], // invalid
    ['p', b], // wrong tag
  ]);
  assert.deepEqual(out, [nip19.npubEncode(a), nip19.npubEncode(b)]);

  const many = Array.from({ length: MAX_BOT_TAGS + 5 }, () => [
    'bot',
    getPublicKey(generateSecretKey()),
  ]);
  assert.equal(addressedBots(many).length, MAX_BOT_TAGS);
  assert.equal(addressedBots([]).length, 0);
});

test('quoting terminates multi-word values', () => {
  const m = announceManifest();
  const p = parseCommandText(m, '/announce "Hello everyone" "Meeting at 5pm"');
  assert.equal(p.args[0][1], 'Hello everyone');
  assert.equal(p.args[1][1], 'Meeting at 5pm');
});

test('usage_line renders required and optional', () => {
  const spec = {
    name: 'roll',
    description: '',
    args: [
      { name: 'sides', type: 'int', description: '', required: true },
      { name: 'label', type: 'string', description: '', required: false },
    ],
  };
  assert.equal(usageLine(spec), '/roll <sides:int> [label:text]');
});

console.log(`\n${passed} passed${process.exitCode ? ', FAILURES above' : ''}\n`);
