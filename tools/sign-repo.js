#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class RepositorySigner {
  constructor(repoDir = './repo') {
    this.repoDir = path.resolve(repoDir);
    this.confDir = path.join(this.repoDir, 'conf');
  }

  generateGpgKey() {
    try {
      console.log('Generating GPG key...');
      
      const keyGenScript = `
%no-protection
Key-Type: RSA
Key-Length: 4096
Subkey-Type: RSA
Subkey-Length: 4096
Name-Real: Kylin Desktop Package Manager
Name-Email: repo@kylin-desktop.com
Expire-Date: 0
%commit
%echo done
`;
      
      execSync(`echo "${keyGenScript}" | gpg --batch --generate-key`, { 
        stdio: 'inherit',
        cwd: this.repoDir
      });
      
      console.log('GPG key generated successfully');
    } catch (error) {
      console.error('Failed to generate GPG key:', error.message);
      throw error;
    }
  }

  exportPublicKey() {
    try {
      console.log('Exporting public key...');
      
      const pubkeyPath = path.join(this.repoDir, 'public.key');
      execSync(`gpg --armor --export repo@kylin-desktop.com > ${pubkeyPath}`, { 
        stdio: 'inherit',
        cwd: this.repoDir
      });
      
      console.log(`Public key exported to: ${pubkeyPath}`);
      return pubkeyPath;
    } catch (error) {
      console.error('Failed to export public key:', error.message);
      throw error;
    }
  }

  signRepository() {
    try {
      console.log('Signing repository...');
      
      execSync(`reprepro --ask-passphrase export focal`, { 
        stdio: 'inherit',
        cwd: this.repoDir
      });
      
      console.log('Repository signed successfully');
    } catch (error) {
      console.error('Failed to sign repository:', error.message);
      throw error;
    }
  }

  setupSigning() {
    try {
      console.log('Setting up repository signing...');
      
      const distributionsPath = path.join(this.confDir, 'distributions');
      let distributionsContent = fs.readFileSync(distributionsPath, 'utf8');
      
      if (!distributionsContent.includes('SignWith')) {
        distributionsContent += '\nSignWith: yes';
        fs.writeFileSync(distributionsPath, distributionsContent);
        console.log('Added SignWith: yes to distributions file');
      }
      
      console.log('Repository signing setup completed');
    } catch (error) {
      console.error('Failed to setup signing:', error.message);
      throw error;
    }
  }

  run() {
    try {
      this.generateGpgKey();
      this.exportPublicKey();
      this.setupSigning();
      this.signRepository();
      console.log('Repository signing process completed successfully');
    } catch (error) {
      console.error('Repository signing process failed:', error.message);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  const signer = new RepositorySigner();
  signer.run();
}

module.exports = RepositorySigner;