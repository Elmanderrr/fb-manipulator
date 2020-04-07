#!/usr/bin/env node

const process = require('process');
const path = require('path');
const simpleGit = require('simple-git/promise');
const git = simpleGit()
const inquirer = require('inquirer');
const _ = require('lodash');
const chalk = require('chalk');

const updateFbValue = 'Update FB';
const createFbValue = 'Create FB';
const skipMerged = '--skipMerged';

const merger = {
    rootDir: process.cwd(),
    public: path.join(process.cwd(), 'public'),
    hmi: path.join(process.cwd(), 'TSHMI_Core'),
    skipMerged: process.argv.includes(skipMerged),

    getQuestions() {
        return [
            {
                type: 'rawlist',
                name: 'job',
                message: 'What do you want to do?',
                choices: [
                    createFbValue,
                    updateFbValue,
                ]
            },

            {
                type: 'checkbox',
                message: 'Select submodules which should be included in this feature',
                name: 'submodules',
                choices: [
                    this.hmi,
                    this.public
                ],
                when: (answers) => answers.job === createFbValue,
                validate: (answer) => {
                    if (answer.length < 1) {
                        return 'You must choose at least one submodule.';
                    }

                    return true;
                }
            },
            {
                type: 'input',
                name: 'jiraTicket',
                message: 'Enter Jira ticket number(4 digits)?',
                transformer: (input) => {
                    if ( input ) {
                        const filtered = this.branches.filter(b => b.includes(input));
                        const tip = filtered.length > 2 ? `Matches ${filtered.length} branches` : filtered;

                        return `${input} => (${tip})?`
                    } else {
                        return input
                    }
                },
                when: (answers) => answers.job === updateFbValue,
                validate: (input) =>  {
                    if ( /^(\d{4})$/.test(input) ) {
                        return true
                    } else {
                        return 'Wrong Jira ticket, must exact 4 numbers'
                    }
                }
            },
            {
                type: 'input',
                name: 'branchName',
                message: 'Enter valid branch name (feature|bugfix|improvement|library|prerelease|release|hotfix)',
                when: (answers) => answers.job === createFbValue,
                validate: (input) => {
                    const regExp = /^(feature|bugfix|improvement|library|prerelease|release|hotfix)\/[\/a-zA-Z0-9._-]+$/;

                    return regExp.test(input) || 'Enter valid branch name  (e.g., feature/TSHMI-1111/your-awesome-feature)'
                }
            },
            {
                type: 'confirm',
                name: 'submitNewBranch',
                message: (answers)=> {
                    return `I will create branch ${answers.branchName} for VDP and for submodules: ${answers.submodules.join(' and ')}. All is correct?`
                },
                default: false,
                when: (answers) => answers.job === createFbValue,
            },
        ]
    },

    async init () {

        console.log(chalk.magenta(`[${this.rootDir}]`), `Checkout to develop`);
        await git.checkout('develop');

        console.log(chalk.magenta(`[${this.rootDir}]`), `Pull from origin/develop`)
        await git.pull('origin/develop');

        this.branches = await this.getUniqBranchesList();

        inquirer.prompt(this.getQuestions()).then(async (answers) => {
            console.log(answers)

            switch (answers.job) {
                case updateFbValue:
                    this.runFbUpdater(answers);
                    break;

                case createFbValue:
                    this.runFbCreator(answers)
                    break;

                default:
                    console.log('unknown job')
            }

        });
    },

    /**
     *
     * @param gitInstance
     * @returns {Promise<*>}
     */
    async getUniqBranchesList (gitInstance = git) {
        const branches = await gitInstance.branch();
        const uniqList = _.uniq(
            branches.all.map(b => b.replace('remotes/origin/', ''))
        );

        return uniqList
    },

    /**
     *
     * @param dir
     */
    changeNodeProcessDir(dir) {
        const curDir = process.cwd();

        process.chdir(dir);

        console.log(`Current Nodejs working directory was changed from ${curDir} to ${process.cwd()}`)
    },

    /**
     *
     * @param submodule
     * @param answers
     * @returns {Promise<void>}
     */
    async syncWithSubmodule(submodule, answers) {
        console.log(chalk.black.bgYellowBright.bold(`Syncing ${submodule}`));

        this.changeNodeProcessDir(submodule);

        console.log(chalk.magenta(`[${submodule}]`), `Checkout to develop`);
        await simpleGit(process.cwd()).checkout('develop');

        console.log(chalk.magenta(`[${submodule}]`), `Pull from origin/develop`)
        await simpleGit(process.cwd()).pull('origin/develop');

        const subModuleBranches = await this.getUniqBranchesList(simpleGit(process.cwd()));;
        const targetSubmoduleBranch = subModuleBranches.find(b => b.includes(answers.jiraTicket));

        if ( !targetSubmoduleBranch  ) {
            console.log(chalk.magenta(`[${submodule}]`), `FB wasn't found, stay on develop`);
            simpleGit(process.cwd()).checkout('develop');
        } else if (targetSubmoduleBranch && await this.isTargetBranchExistInDevelop(submodule, targetSubmoduleBranch) && !this.skipMerged) {
            console.log(chalk.magenta(`[${submodule}]`), `Seems like ${targetSubmoduleBranch} is merged to origin/develop, stay on develop`);
            simpleGit(process.cwd()).checkout('develop');
        } else {
            console.log(chalk.magenta(`[${submodule}]`), `${targetSubmoduleBranch} wasn't merged to origin/develop yet.`);
            console.log(chalk.magenta(`[${submodule}]`), `Checkout to ${targetSubmoduleBranch}`);

            await simpleGit(process.cwd()).checkout(targetSubmoduleBranch);

            try {
                await simpleGit(process.cwd()).silent(true).pull();
            } catch (e) {
                const noTrack = 'There is no tracking information for the current branch';

                if ( e.message.includes(noTrack) ) {
                    console.log(noTrack);
                } else {
                    throw new Error(e);
                }
            }
        }
    },

    /**
     *
     * @returns {Promise<void>}
     */
    async runFbUpdater (answers) {
        const targetBranch = this.branches.find(b => b.includes(answers.jiraTicket));

        console.log(chalk.magenta(`[${this.rootDir}]`), `Checkout to ${targetBranch}`)
        await git.checkout(targetBranch);

        console.log(chalk.magenta(`[${this.rootDir}]`), `Pull from ${targetBranch}`);

        try {
            await git.silent(true).pull()
        } catch (e) {
            const noTrack = 'There is no tracking information for the current branch';

            if ( e.message.includes(noTrack) ) {
                console.log(noTrack);
            } else {
                throw new Error(e);
            }
        }


        await this.syncWithSubmodule(this.public, answers);
        await this.syncWithSubmodule(this.hmi, answers);
    },
    
    async runFbCreator (answers) {
        if ( !answers.submitNewBranch ) {
            console.log(chalk.red.bold('Aborting'))
            return
        }

        for (const submodule of [this.rootDir, ...answers.submodules] ) {
            this.changeNodeProcessDir(submodule);

            console.log(chalk.magenta(`[${submodule}]`), `Checkout to develop`);
            await simpleGit(process.cwd()).checkout('develop');

            console.log(chalk.magenta(`[${submodule}]`), `Pull from origin/develop`);
            await simpleGit(process.cwd()).pull('origin/develop');

            console.log(chalk.magenta(`[${submodule}]`), `Creating branch ${answers.branchName}`);
            await simpleGit(process.cwd()).checkoutLocalBranch(answers.branchName)
        }

    },

    /**
     *
     * @param submodule
     * @param checkingBranch
     * @returns {Promise<string>}
     */
    async isTargetBranchExistInDevelop(submodule, checkingBranch) {
        if ( !checkingBranch ) {
            throw Error(`No checkingBranch was provided.`)
        }

        console.log(chalk.magenta(`[${submodule}]`), `Checkout to ${checkingBranch}`)
        await simpleGit(process.cwd()).checkout(checkingBranch)

        const lastCommitPromise =  await git.raw(['rev-parse', checkingBranch]);
        const lastCommitId = lastCommitPromise.trim();
        const branchContainsCommit = await git.raw(['branch', '--contains', lastCommitId]);

        console.log(`commitId ${lastCommitId} is exist in follow branches: \n`, branchContainsCommit)
        console.log(`Check if ${lastCommitId} is exist in develop`);

        return branchContainsCommit.trim().split('\n').find(b => b.includes('develop'))
    }
}


merger.init()


// TODO
// update -> submodules checkout to FB and check if FB was merged to origin/develop. If yes, checkout and pull from origin/develop
