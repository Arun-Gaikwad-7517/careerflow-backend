const readline = require('readline');
const bcrypt = require('bcryptjs');
const { query, testConnection } = require('../src/config/db');

function promptInput(queryText, hideInput = false) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    if (hideInput && process.stdin.isTTY) {
      // Mask password input on TTY
      process.stdout.write(queryText);
      let password = '';
      process.stdin.setRawMode(true);
      process.stdin.resume();

      const onData = (char) => {
        char = char.toString('utf8');
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            rl.close();
            resolve(password);
            break;
          case '\u0003': // Ctrl+C
            process.exit();
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };

      process.stdin.on('data', onData);
    } else {
      rl.question(queryText, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

async function main() {
  console.log('==============================================');
  console.log('       ADMIN ACCOUNT CREATION UTILITY         ');
  console.log('==============================================\n');

  const status = await testConnection();
  if (!status.connected) {
    console.error('Database connection error:', status.error);
    process.exit(1);
  }

  let email = process.env.ADMIN_EMAIL;
  let password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.log('Please provide admin credentials:\n');

    if (!email) {
      email = await promptInput('Enter Admin Email: ');
    }

    if (!email || !email.includes('@')) {
      console.error('\nError: Invalid email address provided.');
      process.exit(1);
    }

    if (!password) {
      password = await promptInput('Enter Admin Password: ', true);
      const confirmPassword = await promptInput('Confirm Admin Password: ', true);

      if (password !== confirmPassword) {
        console.error('\nError: Passwords do not match.');
        process.exit(1);
      }
    }
  }

  if (!password || password.length < 6) {
    console.error('\nError: Password must be at least 6 characters long.');
    process.exit(1);
  }

  console.log('\nHashing password with bcrypt (cost factor 12)...');
  const saltRounds = 12;
  const hash = bcrypt.hashSync(password, saltRounds);

  try {
    const existing = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);

    if (existing && existing.length > 0) {
      await query(
        'UPDATE users SET role = "ADMIN", password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [hash, existing[0].id]
      );
      console.log(`\n✅ Existing user (${email}) successfully promoted to ADMIN!`);
    } else {
      await query(
        'INSERT INTO users (full_name, email, role, password_hash) VALUES (?, ?, "ADMIN", ?)',
        ['System Administrator', email, hash]
      );
      console.log(`\n✅ Dedicated Admin account (${email}) created successfully!`);
    }

    console.log('Plaintext password was NOT logged or written to disk.\n');
  } catch (err) {
    console.error('\nDatabase query error:', err.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
