module.exports = function(grunt){
	'use strict';

	var	Routes = require('./lib/routes.js');

	// the main task
	grunt.registerMultiTask('acf', 'exports ACF fields', function(){
		var	self = this,
			options = this.options({
				encoding: grunt.file.defaultEncoding,
			});

		new Routes( options, grunt, self );
	});
};

