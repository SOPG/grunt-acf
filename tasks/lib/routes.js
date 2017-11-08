var Q = require('q'),
	http = require('superagent'),
	cheerio = require('cheerio');

module.exports = function( opts, gruntContext, TaskContext )
{
	'use strict';

	var self = this;
	var grunt = gruntContext;
	var task = TaskContext;

	// tell grunt that this is a async task
	// it returns a function that needs to be executed
	// when the task is done
	this.gruntDone = TaskContext.async();

	// store grunt options
	this.options = opts || {};

	this.exportJson = opts.json || false;

	// based on above options
	// we want to build some shortcuts
	this.origin = 'http://' + this.options.baseUrl;
	
	// this is a shortcut to get the routes
	// for the wp-backend, acf-settings page,
	// plugin page etc.
	this.routes = {
		'login':		      '/wp-login.php',
		'plugin':			  '/wp-admin/plugins.php',
		'acfForm':			  '/wp-admin/edit.php?post_type=acf-field-group&page=acf-settings-export',
		'acfToolsForm':		  '/wp-admin/edit.php?post_type=acf-field-group&page=acf-settings-tools',
        /* ACF Tools Form 565 added 2017-11-07 (ACF 5.6.5) */
        'acfToolsForm565':    '/wp-admin/edit.php?post_type=acf-field-group&page=acf-tools',
		'legacyAcfForm':	  '/wp-admin/edit.php?post_type=acf&page=acf-export'
	};

	// object containing static error messages
	this.errors = {
		'missingContext': 'Options are incomplete or grunt-context is missing',
		'needLogin': 'You need to login first',
		'couldNotLogin': 'could not login',
		'pluginNotInstalled': 'ACF plugin is not installed',
		'needValidPluginVersion': 'Got no valid acf version',
		'notExpectedLoginForm': 'Not expected login form found (Login session potentially timed out)',
		'noNonceFound': 'No nonce found @ACF Export page',
		'noExportPostsFound': 'No posts found @ACF Export page',
		'noTextareaFound': 'no textarea containing export-code found inside ACF-Export page',
		'couldNotParseVersion': 'could not parse acf version number'
	};

	// the agent stores a cookie
	// this is why we only want one agent
	// ..yeah we could do a little bit more async
	// but performance does not matter in the first place 
	this.agent = http.agent();

	// shortcut to console log
	this.log = grunt.log.writeln;

	// some internal state & properties
	this.isLoggedIn = false;
	this.acfVersion = false;
	this.exportContent = null;
	this.acfFormBody = null;

	// guard basic stuff
	if( !opts || !gruntContext || !TaskContext ){
		throw this.errors.missingContext;
	}

	/**
	 * this function initiates the routes
	 * this is called at the end of this constructor fn
	 * @return {void}
	 */
	this.run = function()
	{
		self.login()
			.then(self.getPluginVersion)
			.then(self.requestForm)
			.then(self.submitForm)
			.then(self.writeExportCode)
			.then(self.gruntDone);
	};

	/**
	 *
	 * routing stuff is below
	 * 
	 */

	/**
	 * logs the user in
	 * @return {deferred promise}
	 */
	this.login = function()
	{
		var deferred = Q.defer();

		// short-circuit if user is already logged in
		// @todo: check the cookie if the user is actually logged in
		if( true === self.isLoggedIn ){
			deferred.resolve();
			return deferred.promise;
		}

		self.agent.post(self.origin + self.routes.login)
		.set('Host', self.options.baseUrl)
		.set('Origin', self.origin)
		.set('Referer', self.origin + self.routes.login)
		.type('form')
		.send({
			log: self.options.user,
			pwd: self.options.password
		})
		.end(function(err, res){
			if(err) throw err;

			var $ = cheerio.load(res.text);

			// if login form appears again:
			// the login was not successful
			if( true === self.findLoginForm($) ){
				self.log( res.status );
				self.log( res.text );
				throw self.errors.couldNotLogin;
			}
			self.log('successful login');
			self.isLoggedIn = true;

			deferred.resolve();

		});

		return deferred.promise;
	};

	/**
	 * gets the plugin version number from the plugin page
	 * @return {promise}
	 */
	this.getPluginVersion = function()
	{
		var deferred = Q.defer();

		if( false === self.isLoggedIn ){
			throw self.errors.needLogin;
		}

		self.agent.get( self.origin + self.routes.plugin )
		.set('Host', self.options.baseUrl)
		.set('Origin', self.origin)
		.set('Referer', self.origin + self.routes.login)
		.end(function(err, res){

			var $ = cheerio.load(res.text),
				legacyAcf = $('#advanced-custom-fields .plugin-version-author-uri, [data-slug="advanced-custom-fields-pro"] .plugin-version-author-uri').text(),
				currentAcf = $('#advanced-custom-fields-pro .plugin-version-author-uri, [data-slug="advanced-custom-fields"] .plugin-version-author-uri').text();

			if( 0 === currentAcf.length && 0 === legacyAcf.length ){
				throw self.errors.pluginNotInstalled;
			}

			if( currentAcf.length ){
				self.acfVersion = self.parseAcfVersionNumber( currentAcf );
			}else{
				self.acfVersion = self.parseAcfVersionNumber( legacyAcf );
			}

			self.log('found version ACF v' + self.acfVersion.join('.'));

			deferred.resolve();
		});

		return deferred.promise;
	};

	/**
	 * gets the Acf export form
	 * and checks which version to use
	 * @return {promise}
	 */
	this.requestForm = function()
	{
		if( self.acfVersion && self.acfVersion[0] >= 5 ){
			return self.getExportForm();
		}

		if( self.acfVersion && self.acfVersion[0] < 5 ){
			return self.getLegacyExportForm();
		}

		throw self.erros.needValidPluginVersion;
	};

	/**
	 * gets the export form
	 * for v5.0 and higher
	 * @return {promise}
	 */
	this.getExportForm = function()
	{
		var deferred = Q.defer();
		
		if( false === self.isLoggedIn ){
			throw self.errors.needLogin;
		}

		self.agent.get(self.getFormUrl())
		.set('Host', self.options.baseUrl)
		.set('Origin', self.origin)
		.set('Referer', self.origin + self.routes.login)
		.end(function(err, res){
			if(err) throw err;

			var $ = cheerio.load(res.text),
				nonce = $('input[name="' + self.getSelector('_acfnonce') + '"]'),
                //posts = $('#acf-export-field-groups input[name="acf_export_keys[]"]'),
				posts = $(self.getSelector('_field_groups')),
				//submitMessage = $('input[name="generate"]')[0].attribs.value;
   				submitMessage = $(self.getSelector('_generate'))[0].attribs.value;

			if( true === self.findLoginForm($) ){
				throw self.errors.notExpectedLoginForm;
			}

			if( 0 === nonce.length ){
				throw self.errors.noNonceFound;
			}

			if( 0 === posts.length ){
				throw self.errors.noExportPostsFound;
			}

			nonce = nonce[0].attribs.value;

			self.acfFormBody = self.buildAcfExportFormbody(nonce, posts, submitMessage);

			deferred.resolve();
		});

		return deferred.promise;
	};

	/**
	 * GETs the legacy export form and computes the HTTP Body for the POST request
	 * @return {promise}
	 */
	this.getLegacyExportForm = function()
	{
		var deferred = Q.defer();

		if( false === self.isLoggedIn ){
			throw self.errors.needLogin;
		}

		self.agent.get(self.getFormUrl())
		.set('Host', self.options.baseUrl)
		.set('Origin', self.origin)
		.set('Referer', self.origin + self.routes.login)
		.end(function(err, res){
			if(err) throw err;

			var $ = cheerio.load(res.text),
				nonce = $('#wpbody-content .wrap form input[name="nonce"]'),
				posts = $('form table select').children();

			if( true === self.findLoginForm($) ){
				throw self.errors.notExpectedLoginForm;
			}

			if( 0 === nonce.length ){
				self.log(res.text);
				self.log(nonce);
				throw self.errors.noNonceFound;
			}

			if( 0 === posts.length  ){
				throw self.erros.noExportPostsFound;
			}

			nonce = nonce[0].attribs.value;

			self.acfFormBody = self.buildLegacyAcfExportFormbody(nonce, posts);

			deferred.resolve();
		});

		return deferred.promise;
	};

	/**
	 * submits the Acf form
	 * and checks which version to use
	 * 
	 * @return {promise}
	 */
	this.submitForm = function()
	{
		if( self.acfVersion && self.acfVersion[0] >= 5 ){
			return self.submitExportForm();
		}

		if( self.acfVersion && self.acfVersion[0] < 5 ){
			return self.submitLegacyExportform();
		}

		throw self.errors.needValidPluginVersion;
	};

	/**
	 * submits the export form
	 * for v5.0 and higher
	 * @todo  implement new export form submission
	 * @return {promise}
	 */
	this.submitExportForm = function()
	{
		var deferred = Q.defer();
		
		if( false === self.isLoggedIn){
			throw self.errors.needLogin;
		}
        
        var fnCallback = function(err, res)
        {
			if(err) throw err;
            
			var $ = cheerio.load(res.text);
			var textarea = $('#wpbody-content textarea');
            
			if( self.exportJson === true ){

				self.exportContent = JSON.stringify(res.body, null, '\t');
                
			}else{

				if( 0 === textarea.length ){
					throw self.errors.noTextareaFound;
				}

				self.exportContent = "<?php \n" + textarea.text();
				self.activateAddons();
			}

			deferred.resolve();
		};
        
        if (self.acfVersion[0] >= 5
        && (self.acfVersion[1] >= 6)
        && (self.acfVersion[2] >= 5)) { // ACF >= 5.6.5 (2017-11-07)
            
            self.agent.post(self.getFormUrl() + '&' + self.acfFormBody)
            .type('form')           
            .end(fnCallback);
            
        } else { // ACF <= 5.6.4

            self.agent.post(self.getFormUrl())
            .type('form')
            .send(self.acfFormBody)
            .end(fnCallback);
        }

		return deferred.promise;
	};

	/**
	 * submits the legacy export form
	 * using HTTP body built before
	 * @return {promise}
	 */
	this.submitLegacyExportform = function()
	{
		var deferred = Q.defer();

		if( false === self.isLoggedIn ){
			throw self.errors.needLogin;
		}

		self.agent.post(self.getFormUrl())
		.type('form')
		.send(self.acfFormBody)
		.end(function(err, res){
			if(err) throw err;

			var $ = cheerio.load(res.text);
            var textarea = $('#wpbody-content textarea');

			if( textarea.length === 0 ){
				throw self.errors.noTextareaFound;
			}

			self.exportContent = "<?php \n" + textarea.text();
			self.activateAddons();

			deferred.resolve();

		});

		return deferred.promise;
	};

	/**
	 * writes the export code to the defined file
	 * @return {promise}
	 */
	this.writeExportCode = function()
	{
		var deferred = Q.defer();
		deferred.resolve();
		self.log( 'writing to file: ' + task.files[0].dest );
		self.log( 'wrote ' + self.exportContent.split('\n').length + ' lines' );
		grunt.file.write(task.files[0].dest, self.exportContent);

		return deferred.promise;
	};

	/**
	 * 
	 * some helper functions are below
	 * 
	 */
	
	/**
	 * returns the form url for the set version
	 * @return {String} 
	 */
	this.getFormUrl = function()
    {
		if( !self.acfVersion ){
			throw self.errors.couldNotParseVersion;
		}

		var url = '';

        // 5.6.5+ (2017-11-07)
        if (parseInt(self.acfVersion[0]) >= 5 
        && (parseInt(self.acfVersion[1]) >= 6) 
        && (parseInt(self.acfVersion[2]) >= 5)) {
            url = '' + self.origin + self.routes.acfToolsForm565;
        }
        
		// 5.3 - 5.6.4
        if (parseInt(self.acfVersion[0]) === 5 
        && (parseInt(self.acfVersion[1]) <= 6) 
        && (parseInt(self.acfVersion[1]) >= 3) 
        && ((parseInt(self.acfVersion[2]) < 5 && parseInt(self.acfVersion[1]) === 6) || (parseInt(self.acfVersion[1]) < 6))) {            
            url = '' + self.origin + self.routes.acfToolsForm;
        }

		// 5.0 - 5.2
		if (parseInt(self.acfVersion[0]) === 5 
        && (parseInt(self.acfVersion[1]) < 3 )) {
			url = '' + self.origin + self.routes.acfForm;
		}

		// <5.0 legacy url
		if( self.acfVersion[0] < 5 ){
			url = self.origin + self.routes.legacyAcfForm;
		}
        
		return url;
	};

	/**
	 * finds a login form on a given cheerio context
	 * @param  {cheerio} $
	 * @return {bool}
	 */
	this.findLoginForm = function( $ )
	{
		if( $('#loginform').length === 0){
			return false;
		}
		return true;
	};

	/**
	 * activates the addons
	 * @modifies self.exportContent
	 */
	this.activateAddons = function()
	{

		/**
		 * optional: activate addons 
		 */
		if( self.options.addons ){
			self.log('activating addons');

			// replace repeater
			self.options.addons.repeater ?
				self.exportContent = self.exportContent.replace(
					"// include_once('add-ons/acf-repeater/acf-repeater.php');",
					"include_once( ABSPATH . '/wp-content/plugins/acf-repeater/acf-repeater.php');")
				: '';

			// gallery
			self.options.addons.gallery ?
				self.exportContent = self.exportContent.replace(
					"// include_once('add-ons/acf-gallery/acf-gallery.php');",
					"include_once( ABSPATH . '/wp-content/plugins/acf-gallery/acf-gallery.php');")
				: '';
			// fc
			self.options.addons.flexible ?
				self.exportContent = self.exportContent.replace(
					"// include_once('add-ons/acf-flexible-content/acf-flexible-content.php');",
					"include_once( ABSPATH . '/wp-content/plugins/acf-flexible-content/acf-flexible-content.php');")
				: '';
			
			// options
			self.options.addons.options ?
				self.exportContent = self.exportContent.replace(
					"// include_once( 'add-ons/acf-options-page/acf-options-page.php' );",
					"include_once( ABSPATH . '/wp-content/plugins/acf-options-page/acf-options-page.php');")
				: '';
		}

		if( self.options.condition ){
			self.log('adding conditions');
			// legacy
			self.exportContent = self.exportContent.replace(
				'if(function_exists("register_field_group"))',
				'if(function_exists("register_field_group") && ' + self.options.condition + ' )'
			);

			// current
			self.exportContent = self.exportContent.replace(
				"if( function_exists('register_field_group') ):",
				"if( function_exists('register_field_group') && " + self.options.condition + " ):"
			);
		}
	};

	/**
	 * parses the version number from a string
	 * returns an array containing the matched version digits
	 * 
	 * @param  {string} text
	 * @return {array}
	 */
	this.parseAcfVersionNumber = function( text )
	{
		var matched = text.match(/\d+\.\d+\.\d+/);
		
		if( matched.length > 0 && 3 === matched[0].split('.').length ){
			return matched[0].split('.');
		}
		self.log('could find version number in string: "' + text + '"');
		throw self.errors.couldNotParseVersion;
	};

	/**
	 * builds up the HTTP Body for the POST request
	 * @param  {string} nonce
	 * @param  {cheerio node array} nodes
	 * @param  {string} generate
	 * @return {string}
	 */
	this.buildAcfExportFormbody = function(nonce, nodes, generate)
	{
		generate = generate || "Erstelle+Export+Code";
		/* Quoted out 2017-11-07, ACF 5.6.5 */
        //var body = self.getSelector('_acfnonce') + '=' + nonce + '&acf_export_keys=';
        var body = self.getSelector('_acfnonce') + '=' + nonce + self.getSelector('_exportUriComponent');

        // get all posts' values
		nodes = nodes.map(function(i, el){
			return el.attribs.value;
		});

        if (self.acfVersion[0] >= 5 
        && (self.acfVersion[1] >= 6) 
        && (self.acfVersion[2] >= 5)) { // ACF 5.6.5+ (2017-11-07)
            
            body += 'keys=';
            for( var i = 0; i < nodes.length; i++ ){
                var el = nodes[i];
                body += el + "+";
                self.log('adding post #' + el);
            }
            body = body.substr(0, body.length - 1);
            
        } else { // ACF <= 5.6.4
            
            // for each post: append to formBody
            for( var i = 0; i < nodes.length; i++ ){
                var el = nodes[i];var el = nodes[i];
                /* Quoted out 2017-11-07, ACF 5.6.5 */
                //body += encodeURIComponent("acf_export_keys[]") + "=" + el + "&";
                body += encodeURIComponent(self.getSelector('_keysUriComponent')) + "=" + el + "&";
                self.log('adding post #' + el);
            }
        }

		if( self.exportJson === true ){
            if (self.acfVersion[0] >= 5 
            && (self.acfVersion[1] >= 6) 
            && (self.acfVersion[2] >= 5)) { // ACF 5.6.5+ (2017-11-07)
                
                body += "&action=download";
                
            } else { // ACF <= 5.6.4
                
                body += "&download=" + "JSON-Datei exportieren";
                
            }            
		}else{
			body += "&generate=" + generate;
		}

		return body;

	};

	/**
	 * builds the submission form
	 * @param  {string} nonce
	 * @param  {cherrio node array} nodes
	 * @param  {string} submit
	 * @return {string}
	 */
	this.buildLegacyAcfExportFormbody = function( nonce, nodes, submit )
	{
		submit = submit || "Export+als+PHP";
		var body = "nonce=" + nonce + "&acf_posts=&export_to_php=" + submit;
		return body;
	};
    
        /**
         * get selector dependend of version
         * 
         * @param {type} string
         * @returns {module.exports.getSelector.identifier}
         */
        this.getSelector=function(identifier)
        {
            switch(identifier) {
                case '_acfnonce':
                    if((self.acfVersion[0]>=5) && (self.acfVersion[1]>=6)) {
                        identifier='_acf_nonce';
                    }
                    break;
                    
                case '_field_groups':
                    // >= 5.6.5 (2017-11-07)
                    if (self.acfVersion[0] >= 5
                    && (self.acfVersion[1] >= 6)
                    && (self.acfVersion[2] >= 5)) {
                        identifier = '.acf-fields input[name="keys[]"]';
                    }
                    // <= 5.6.4
                    if (self.acfVersion[0] <= 5
                    && (self.acfVersion[1] <= 6)
                    && ((self.acfVersion[2] <= 4 && self.acfVersion[1] === 6) || (self.acfVersion[1] < 6))) {
                        identifier = '#acf-export-field-groups input[name="acf_export_keys[]"]';
                    }
                    break;
                 
                case '_generate':
                    // >= 5.6.5 (2017-11-07)
                    if (self.acfVersion[0] >= 5
                    && (self.acfVersion[1] >= 6)
                    && (self.acfVersion[2] >= 5)) {
                        identifier = 'button[name="action"][value="generate"]';
                    }
                    // <= 5.6.4
                    if (self.acfVersion[0] <= 5
                    && (self.acfVersion[1] <= 6)
                    && ((self.acfVersion[2] <= 4 && self.acfVersion[1] === 6) || (self.acfVersion[1] < 6))) {
                        identifier = 'input[name="generate"]';
                    }
                    break;
                    
                case '_keysUriComponent':
                    // >= 5.6.5 (2017-11-07)
                    if (self.acfVersion[0] >= 5
                    && (self.acfVersion[1] >= 6)
                    && (self.acfVersion[2] >= 5)) {
                        identifier = 'keys[]';
                    }
                    // <= 5.6.4
                    if (self.acfVersion[0] <= 5
                    && (self.acfVersion[1] <= 6)
                    && ((self.acfVersion[2] <= 4 && self.acfVersion[1] === 6) || (self.acfVersion[1] < 6))) {
                        identifier = 'acf_export_keys[]';
                    }
                    break;
                case '_exportUriComponent':
                    
                    // >= 5.6.5 (2017-11-07)
                    if (self.acfVersion[0] >= 5
                    && (self.acfVersion[1] >= 6)
                    && (self.acfVersion[2] >= 5)) {
                        if (false === self.exportJson) {
                            identifier = '&tool=export&';
                        } else {
                            identifier = '&action=download&';
                        }
                    }
                    // <= 5.6.4
                    if (self.acfVersion[0] <= 5
                    && (self.acfVersion[1] <= 6)
                    && ((self.acfVersion[2] <= 4 && self.acfVersion[1] === 6) || (self.acfVersion[1] < 6))) {
                        identifier = '&acf_export_keys=&';
                    }
                    break;
                    
                default:break;
            }
            
            return identifier;
        };

	this.run();

};
