module.exports = function(grunt){
	var	http = require('superagent'),
		Routes = require('./routes.js');
		cheerio = require('cheerio');

	// the main task
	grunt.registerMultiTask('acf', 'exports ACF fields', function(){
		var gruntDone = this.async(),
			self = this,
			options = this.options({
				encoding: grunt.file.defaultEncoding,
			});

		new Routes( options, grunt, self );
	});
};

