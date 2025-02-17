'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { gray, cyan, yellow, redBright, green } = require('chalk');
const { table } = require('table');
const {
	BigNumber,
	utils: { parseUnits },
} = require('ethers');

const {
	constants: {
		CONFIG_FILENAME,
		PARAMS_FILENAME,
		DEPLOYMENT_FILENAME,
		OWNER_ACTIONS_FILENAME,
		SYNTHS_FILENAME,
		STAKING_REWARDS_FILENAME,
		SHORTING_REWARDS_FILENAME,
		VERSIONS_FILENAME,
		FEEDS_FILENAME,
		FUTURES_MARKETS_FILENAME,
	},
	wrap,
} = require('../..');

const {
	getPathToNetwork,
	getSynths,
	getStakingRewards,
	getVersions,
	getFeeds,
	getShortingRewards,
} = wrap({
	path,
	fs,
});

const { networks } = require('../..');
const JSONreplacer = (key, value) => {
	if (typeof value === 'object' && value && value.type === 'BigNumber' && !Array.isArray(value)) {
		return BigNumber.from(value).toString();
	}
	return value;
};
const stringify = input => JSON.stringify(input, JSONreplacer, '\t') + '\n';

const allowZeroOrUpdateIfNonZero = param => input => param === '0' || input !== '0';

const ensureNetwork = network => {
	if (!networks.includes(network)) {
		throw Error(
			`Invalid network name of "${network}" supplied. Must be one of ${networks.join(', ')}.`
		);
	}
};

const getDeploymentPathForNetwork = ({ network, useOvm }) => {
	console.log(gray('Loading default deployment for network'));
	return getPathToNetwork({ network, useOvm });
};

const ensureDeploymentPath = deploymentPath => {
	if (!fs.existsSync(deploymentPath)) {
		throw Error(
			`Invalid deployment path. Please provide a folder with a compatible ${CONFIG_FILENAME}`
		);
	}
};

// Load up all contracts in the flagged source, get their deployed addresses (if any) and compiled sources
const loadAndCheckRequiredSources = ({ deploymentPath, network, freshDeploy }) => {
	console.log(gray(`Loading the list of synths for ${network.toUpperCase()}...`));
	const synthsFile = path.join(deploymentPath, SYNTHS_FILENAME);
	const synths = getSynths({ network, deploymentPath });

	console.log(gray(`Loading the list of staking rewards to deploy on ${network.toUpperCase()}...`));
	const stakingRewardsFile = path.join(deploymentPath, STAKING_REWARDS_FILENAME);
	const stakingRewards = getStakingRewards({ network, deploymentPath });

	console.log(
		gray(`Loading the list of shorting rewards to deploy on ${network.toUpperCase()}...`)
	);
	const shortingRewardsFile = path.join(deploymentPath, SHORTING_REWARDS_FILENAME);
	const shortingRewards = getShortingRewards({ network, deploymentPath });

	console.log(gray(`Loading the list of contracts to deploy on ${network.toUpperCase()}...`));
	const configFile = path.join(deploymentPath, CONFIG_FILENAME);
	const config = JSON.parse(fs.readFileSync(configFile));

	console.log(gray(`Loading the list of deployment parameters on ${network.toUpperCase()}...`));
	const paramsFile = path.join(deploymentPath, PARAMS_FILENAME);
	const params = JSON.parse(fs.readFileSync(paramsFile));

	console.log(gray(`Loading the list of futures markets on ${network.toUpperCase()}...`));
	const futuresMarketsFile = path.join(deploymentPath, FUTURES_MARKETS_FILENAME);
	const futuresMarkets = JSON.parse(fs.readFileSync(futuresMarketsFile));

	const versionsFile = path.join(deploymentPath, VERSIONS_FILENAME);
	const versions = network !== 'local' ? getVersions({ network, deploymentPath }) : {};

	const feedsFile = path.join(deploymentPath, FEEDS_FILENAME);
	const feeds = getFeeds({ network, deploymentPath });

	console.log(
		gray(`Loading the list of contracts already deployed for ${network.toUpperCase()}...`)
	);
	const deploymentFile = path.join(deploymentPath, DEPLOYMENT_FILENAME);
	if (!fs.existsSync(deploymentFile)) {
		fs.writeFileSync(deploymentFile, stringify({ targets: {}, sources: {} }));
	}
	const deployment = JSON.parse(fs.readFileSync(deploymentFile));

	if (freshDeploy) {
		deployment.targets = {};
		deployment.sources = {};
	}

	const ownerActionsFile = path.join(deploymentPath, OWNER_ACTIONS_FILENAME);
	if (!fs.existsSync(ownerActionsFile)) {
		fs.writeFileSync(ownerActionsFile, stringify({}));
	}
	const ownerActions = JSON.parse(fs.readFileSync(ownerActionsFile));

	return {
		config,
		params,
		configFile,
		synths,
		synthsFile,
		stakingRewards,
		stakingRewardsFile,
		futuresMarkets,
		futuresMarketsFile,
		deployment,
		deploymentFile,
		ownerActions,
		ownerActionsFile,
		versions,
		versionsFile,
		feeds,
		feedsFile,
		shortingRewards,
		shortingRewardsFile,
	};
};

const getExplorerLinkPrefix = ({ network, useOvm }) => {
	return `https://${network !== 'mainnet' ? network + (useOvm ? '-' : '.') : ''}${
		useOvm ? 'explorer.optimism' : 'etherscan'
	}.io`;
};

const loadConnections = ({ network, useFork, useOvm }) => {
	// Note: If using a fork, providerUrl will need to be 'localhost', even if the target network is not 'local'.
	// This is because the fork command is assumed to be running at 'localhost:8545'.
	let providerUrl;
	if (network === 'local' || useFork) {
		providerUrl = 'http://127.0.0.1:8545';
	} else {
		if (useOvm) {
			if (network === 'mainnet' && process.env.OVM_PROVIDER_URL) {
				providerUrl = process.env.OVM_PROVIDER_URL;
			} else if (process.env.OVM_GOERLI_PROVIDER_URL) {
				providerUrl = process.env.OVM_GOERLI_PROVIDER_URL;
			}
		} else {
			if (network === 'mainnet' && process.env.PROVIDER_URL_MAINNET) {
				providerUrl = process.env.PROVIDER_URL_MAINNET;
			} else {
				providerUrl = process.env.PROVIDER_URL.replace('network', network);
			}
		}
	}

	const privateKey =
		network === 'mainnet' ? process.env.DEPLOY_PRIVATE_KEY : process.env.TESTNET_DEPLOY_PRIVATE_KEY;

	const etherscanUrl = `https://api${network !== 'mainnet' ? `-${network}` : ''}${
		useOvm ? '-optimistic' : ''
	}.etherscan.io/api`;

	const explorerLinkPrefix = getExplorerLinkPrefix({ network, useOvm });

	return { providerUrl, privateKey, etherscanUrl, explorerLinkPrefix };
};

const confirmAction = prompt =>
	new Promise((resolve, reject) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

		rl.question(prompt, answer => {
			if (/y|Y/.test(answer)) resolve();
			else reject(Error('Not confirmed'));
			rl.close();
		});
	});

const appendOwnerActionGenerator = ({ ownerActions, ownerActionsFile, explorerLinkPrefix }) => ({
	key,
	action,
	target,
	data,
}) => {
	ownerActions[key] = {
		target,
		action,
		complete: false,
		link: `${explorerLinkPrefix}/address/${target}#writeContract`,
		data,
	};
	fs.writeFileSync(ownerActionsFile, stringify(ownerActions));
	console.log(cyan(`Cannot invoke ${key} as not owner. Appended to actions.`));
};

const parameterNotice = props => {
	console.log(gray('-'.repeat(50)));
	console.log('Please check the following parameters are correct:');
	console.log(gray('-'.repeat(50)));

	Object.entries(props).forEach(([key, val]) => {
		console.log(gray(key) + ' '.repeat(40 - key.length) + redBright(val));
	});

	console.log(gray('-'.repeat(50)));
};

function reportDeployedContracts({ deployer }) {
	console.log(
		green(`\nSuccessfully deployed ${deployer.newContractsDeployed.length} contracts!\n`)
	);

	const tableData = deployer.newContractsDeployed.map(({ name, address }) => [
		name,
		address,
		deployer.deployment.targets[name].link,
	]);
	console.log();
	if (tableData.length) {
		console.log(gray(`All contracts deployed on "${deployer.network}" network:`));
		console.log(table(tableData));
	} else {
		console.log(gray('Note: No new contracts deployed.'));
	}
}

const catchMissingResolverWhenGeneratingSolidity = ({
	contract,
	dryRun,
	err,
	generateSolidity,
}) => {
	if ((generateSolidity || dryRun) && /Missing address:\s[\w]+/.test(err.message)) {
		console.log(
			gray(
				`WARNING: Error thrown reading state from ${yellow(
					contract
				)} with missing resolver addresses (expected for new contracts that need their resolvers cached). Ignoring as this is generate-solidity mode.`
			)
		);
	} else {
		throw err;
	}
};

const assignGasOptions = async ({ tx, provider, maxFeePerGas, maxPriorityFeePerGas }) => {
	// only add EIP-1559 options if the network supports EIP-1559
	const gasOptions = {};

	let feeData = {};
	try {
		feeData = await provider.getFeeData();
	} catch (_) {} // network does not support the `getFeeData` rpc call
	if (feeData.maxFeePerGas) {
		gasOptions.type = 2;
		if (maxFeePerGas)
			gasOptions.maxFeePerGas = parseUnits(maxFeePerGas.toString() || '100', 'gwei');
		if (maxPriorityFeePerGas)
			gasOptions.maxPriorityFeePerGas = parseUnits(maxPriorityFeePerGas.toString(), 'gwei');
	}

	return Object.assign(gasOptions, tx);
};

module.exports = {
	allowZeroOrUpdateIfNonZero,
	ensureNetwork,
	ensureDeploymentPath,
	getDeploymentPathForNetwork,
	loadAndCheckRequiredSources,
	getExplorerLinkPrefix,
	loadConnections,
	confirmAction,
	appendOwnerActionGenerator,
	stringify,
	parameterNotice,
	reportDeployedContracts,
	catchMissingResolverWhenGeneratingSolidity,
	assignGasOptions,
};
