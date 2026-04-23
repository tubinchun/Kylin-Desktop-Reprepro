#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

class RepoManager {
  constructor(repoDir = './repo') {
    this.repoDir = path.resolve(repoDir);
    this.confDir = path.join(this.repoDir, 'conf');
  }

  initRepo() {
    try {
      fs.ensureDirSync(this.confDir);
      
      const distributionsContent = `Origin: Kylin Desktop
Label: Kylin Desktop
Codename: focal
Architectures: amd64 i386 source
Components: main
Description: Kylin Desktop 包管理仓库`;
      
      const optionsContent = `verbose
ask-passphrase
basedir .`;
      
      fs.writeFileSync(path.join(this.confDir, 'distributions'), distributionsContent);
      fs.writeFileSync(path.join(this.confDir, 'options'), optionsContent);
      
      console.log('Repository initialized successfully');
    } catch (error) {
      console.error('Failed to initialize repository:', error.message);
      process.exit(1);
    }
  }

  addDebPackage(debFilePath) {
    try {
      const originalDir = process.cwd();
      process.chdir(this.repoDir);
      
      const command = `reprepro includedeb focal ${path.resolve(debFilePath)}`;
      console.log(`Running: ${command}`);
      
      execSync(command, { stdio: 'inherit' });
      
      console.log('Deb package added successfully');
    } catch (error) {
      console.error('Failed to add deb package:', error.message);
      throw error;
    } finally {
      process.chdir(originalDir);
    }
  }

  listPackages() {
    try {
      const originalDir = process.cwd();
      process.chdir(this.repoDir);
      
      const command = 'reprepro list focal';
      const result = execSync(command, { encoding: 'utf8' });
      
      console.log('Packages in repository:');
      console.log(result);
      
      return result;
    } catch (error) {
      console.error('Failed to list packages:', error.message);
      throw error;
    } finally {
      process.chdir(originalDir);
    }
  }

  removePackage(packageName, architecture = 'all') {
    try {
      const originalDir = process.cwd();
      process.chdir(this.repoDir);
      
      const command = `reprepro -A ${architecture} remove focal ${packageName}`;
      console.log(`Running: ${command}`);
      
      execSync(command, { stdio: 'inherit' });
      
      console.log(`Package ${packageName} removed successfully`);
    } catch (error) {
      console.error('Failed to remove package:', error.message);
      throw error;
    } finally {
      process.chdir(originalDir);
    }
  }
}

if (require.main === module) {
  const manager = new RepoManager();
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node repo-manager.js <command> [options]');
    console.log('Commands:');
    console.log('  init                     - Initialize repository');
    console.log('  add <deb-file>           - Add deb package to repository');
    console.log('  list                     - List all packages in repository');
    console.log('  remove <package-name> [arch] - Remove package from repository');
    process.exit(0);
  }
  
  const command = args[0];
  
  switch (command) {
    case 'init':
      manager.initRepo();
      break;
    case 'add':
      if (args.length < 2) {
        console.error('Usage: node repo-manager.js add <deb-file>');
        process.exit(1);
      }
      manager.addDebPackage(args[1]);
      break;
    case 'list':
      manager.listPackages();
      break;
    case 'remove':
      if (args.length < 2) {
        console.error('Usage: node repo-manager.js remove <package-name> [arch]');
        process.exit(1);
      }
      manager.removePackage(args[1], args[2]);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

module.exports = RepoManager;