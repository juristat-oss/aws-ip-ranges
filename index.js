var fs = require('fs');
var path = require('path');
var Promise = require('bluebird');
var request = require('request-promise');

var cacheFile = path.resolve(__dirname, './.aws-ip-ranges.cache');
var ipUrl = 'https://ip-ranges.amazonaws.com/ip-ranges.json';
Promise.promisifyAll(fs);

function debugPrint() {
	if(module.exports.DEBUG) {
		var args = (1 <= arguments.length) ? [].slice.call(arguments, 0) : [];
		console.log.apply(console, args);
	}
};

function checkForFile() {
	return fs.statAsync(cacheFile)
	.then(function(stat) {
		if(stat.isFile()) {
			debugPrint('cache file exists');
			return Promise.resolve();
		} else {
			debugPrint('cache file does NOT exist');
			return Promise.reject();
		}
	});
};

function checkAccess(mode) {
	return function() {
		return fs.accessAsync(cacheFile, mode)
		.tap(function() { debugPrint('cache file access check passed'); });
	};
};

function readFile() {
	return fs.readFileAsync(cacheFile, 'utf8')
	.then(function(contents) { return JSON.parse(contents); });
};

function bootstrapFile() {
	return null;
};

function checkIfUpToDate(cache) {
	if(!cache || !cache.timestamp) {
		debugPrint('cache file does not contain a valid timestamp');
		return Promise.reject();
	}

	var cacheTimestamp = new Date(cache.timestamp);
	var now = new Date();

	// doing the comparison exactly this way ensures that invalid dates cause a rejection
	if(!(cacheTimestamp <= now)) {
		debugPrint('cache timestamp is in the future - ignoring');
		return promise.reject();
	}

	return request.head(ipUrl)
	.then(function(res) {
		if(!res['last-modified']) {
			debugPrint('HEAD request to AWS did not have a last-modified header');
			return Promise.reject();
		}

		// doing the comparison exactly this way ensures that invalid dates cause a rejection
		if(!(new Date(res['last-modified']) <= cacheTimestamp)) {
			debugPrint('cache is out of date');
			return Promise.reject();
		}

		debugPrint('cache is up to date');
		return Promise.resolve(cache);
	});
};

function update() {
	return request.get({url: ipUrl, json: true})
	.then(function(res) {
		return {
			timestamp: new Date(),
			prefixes: res.prefixes
		};
	})
	.tap(function(newCache) {
		debugPrint('writing new cache file');
		return fs.writeFileAsync(cacheFile, JSON.stringify(newCache), 'utf8');
	});
};

function getResults(filter) {
	return function(data) {
		return data.prefixes
		.filter(function(prefix) {
			if(typeof filter === 'string') {
				return prefix.service === filter.toUpperCase().trim();
			} else {
				for(var key in filter) if(filter.hasOwnProperty(key)) {
					if(prefix[key] !== filter[key]) {
						return false;
					}
				}

				return true;
			}
		})
		.map(function(prefix) { return prefix.ip_prefix; });
	};
};

module.exports = function(filter) {
	return checkForFile()
	.then(checkAccess(fs.R_OK | fs.W_OK))
	.then(readFile)
	.catch(bootstrapFile)
	.then(checkIfUpToDate)
	.catch(update)
	.then(getResults(filter));
};

module.exports.isUpToDate = function() {
	return checkForFile()
	.then(checkAccess(fs.R_OK))
	.then(readFile)
	.catch(bootstrapFile)
	.then(checkIfUpToDate)
	.then(function() { return true; })
	.catch(function() { return false; });
};

module.exports.getFromCache = function(filter) {
	return checkForFile()
	.then(checkAccess(fs.R_OK))
	.then(readFile)
	.catchReturn(Promise.reject('cache does not exist or is not readable'))
	.then(getResults(filter));
};

module.exports.deleteCache = function() {
	return fs.unlinkAsync(cacheFile)
	.tap(function() { debugPrint('deleted cache file'); })
	.catch(function() { return fs.writeFileAsync(cacheFile, '', 'utf8'); })
	.tap(function() { debugPrint('could not delete cache file - wrote empty one instead'); });
};
