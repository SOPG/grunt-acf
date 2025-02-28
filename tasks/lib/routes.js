const superagent = require('superagent'),
    fs = require('fs'),
    cheerio = require('cheerio');

function acfExport(oOpts, gruntContext, TaskContext)
{
    'use strict';

    const grunt = gruntContext;

    this.oGruntDone = TaskContext.async();
    this.bDebug = true;

    this.oOptions = oOpts || {};
    this.oAgent = superagent.agent();
    //enable custom protocol
    this.protocol = grunt.config().protocol || 'http';
    this.sBaseUrl = this.protocol + '://' + this.oOptions.baseUrl;

    this.oRoutes = {
        'login': '/wp-login.php',
        'plugin': '/wp-admin/plugins.php',
        'acfToolsForm565': '/wp-admin/edit.php?post_type=acf-field-group&page=acf-tools',
    };

    this.oErrors = {
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

    this.oFiles = {
        'json' : 'acf_export.json',
        'php'  : 'acf_export.php'
    };

    this.log = grunt.log.writeln;

    this.isLoggedIn = false;
    this.acfVersion = false;

    this.acfFormBodyPhp = null;
    this.acfFormBodyJson = null;
    this.exportContentPhp = null;
    this.exportContentJson = null;


    this.init = async () => 
    {
        this.debuglog(this.oOptions);

        await this.login();
        // await this.getPluginVersion();
        await this.getExportForm();
        await this.submitExportForm();
        await this.writeExportCode();

        this.oGruntDone();
    };

    /**
     * Log into wordpress.
     */
    this.login = async () => 
    {
        this.logAction('Logging into Wordpress');

        try {
            const oAgent = this.oAgent.post(this.sBaseUrl + this.oRoutes.login);
            const oRes = await this.maybeAddTlsCertificate(oAgent)
                .set('Host', this.oOptions.baseUrl)
                .set('Origin', this.sBaseUrl)
                .set('Referer', this.sBaseUrl + this.oRoutes.login)
                .type('form')
                .send({
                    log: this.oOptions.user,
                    pwd: this.oOptions.password
                });
    
            /* Load HTML */
            const $ = cheerio.load(oRes.text);
    
            /* If login form appears again, the login was not successful */
            if (0 !== $('#loginform').length) {
                this.log('Status:', oRes.status);
                this.log('Response Headers:', oRes.headers);
                this.log(oRes.text);
                throw this.oErrors.couldNotLogin;
            }

            this.logSuccess('Logged in successfully!');
            this.isLoggedIn = true;
    
        } 
        catch (oError) {
            throw new Error('Login fehlgeschlagen: ' + oError);
        }
    }

    /**
     * Gets ACF plugin version.
     */
    this.getPluginVersion = async () => 
    {
        this.logAction('Detecting ACF Pro plugin version');

        if (false === this.isLoggedIn) {
            throw this.oErrors.needLogin;
        }

        try {
            const oAgent = this.oAgent.get(this.sBaseUrl + this.oRoutes.plugin);
            const oRes = await this.maybeAddTlsCertificate(oAgent)
                .set('Host', this.oOptions.baseUrl)
                .set('Origin', this.sBaseUrl)
                .set('Referer', this.sBaseUrl + this.oRoutes.login);
    
            /* Load HTML */
            const $ = cheerio.load(oRes.text);
    
            /* Get Plugin data (version, url, author) */
            const pluginData = $('#advanced-custom-fields-pro .plugin-version-author-uri, [data-slug="advanced-custom-fields"] .plugin-version-author-uri, [data-slug="advanced-custom-fields-pro"] .plugin-version-author-uri').text();
    
            /* Check if Acf is installed */
            if (0 === pluginData.length) {
                throw this.oErrors.pluginNotInstalled;
            }
    
            /* Parse version */
            if (pluginData.length) {
                this.acfVersion = this.parseAcfVersionNumber(pluginData);
            }
    
            this.logSuccess('ACF Pro plugin version is ' + this.acfVersion.join('.'));
        }
        catch(oError) {
            throw new Error('Plugin-Version nicht gefunden: ' + oError);
        }
    }

    /**
     * Build the form that will be submitted to export the acf data.
     */
    this.getExportForm = async () =>
    {
        this.logAction('Extracting ACF export formular');
        
        if (false === this.isLoggedIn) {
            throw this.oErrors.needLogin;
        }

        try {
            const oAgent = this.oAgent.get(this.sBaseUrl + this.oRoutes.acfToolsForm565);
            const oRes = await this.maybeAddTlsCertificate(oAgent)
                .set('Host', this.oOptions.baseUrl)
                .set('Origin', this.sBaseUrl)
                .set('Referer', this.sBaseUrl + this.oRoutes.login);
    
            /* Load HTML */
            const $ = cheerio.load(oRes.text);

            let aNonce = $('input[name="_acf_nonce"]');
            const aPosts = $('.acf-fields input[name="keys[]"]');
            const sSubmitMessage = $('button[name="action"][value="generate"]')[0].attribs.value;

            /* Check nonce. */
            if (0 === aNonce.length) {
                throw this.oErrors.noNonceFound;
            }

            if (0 === aPosts.length) {
                throw this.oErrors.noExportPostsFound;
            }
            
            aNonce = aNonce[0].attribs.value;

            this.acfFormBodyPhp = this.buildAcfExportFormbody(aNonce, aPosts, sSubmitMessage);
            this.acfFormBodyJson = this.buildAcfExportFormbody(aNonce, aPosts, sSubmitMessage, true);

            this.logSuccess('ACF export formular extracted successfully!');
        }
        catch(oError) {
            throw new Error('Exportformular nicht gefunden: ' + oError);
        }
    }

    /**
     * Submit export forms
     */
    this.submitExportForm = async () =>
    {
        this.logAction('Submitting ACF export formular');

        if (false === this.isLoggedIn) {
            throw this.oErrors.needLogin;
        }
        
        try {
            /* JSON */
            if(true) {
                const oAgent = this.oAgent.post(this.sBaseUrl + this.oRoutes.acfToolsForm565);
                const oRes = await this.maybeAddTlsCertificate(oAgent)
                    .type('form')
                    .send(this.acfFormBodyJson)
    
                this.exportContentJson = JSON.stringify(oRes.body, null, '\t');
            }

            /* PHP */
            if(true) {
                const oAgent = this.oAgent.post(this.sBaseUrl + this.oRoutes.acfToolsForm565 + '&' + this.acfFormBodyPhp);
                const oRes = await this.maybeAddTlsCertificate(oAgent)
                    .type('form');

                const $ = cheerio.load(oRes.text);
                const oTextarea = $('#wpbody-content textarea');

                if (0 === oTextarea.length) {
                    throw this.oErrors.noTextareaFound;
                }

                this.exportContentPhp = "<?php \n" + oTextarea.text();
            }

            this.logSuccess('ACF export formular submitted successfully!');
        }
        catch(oError) {
            throw new Error('Submit fehlgeschlagen: ' + oError);
        }
    }

    /**
     * Write the exported code to files.
     */
    this.writeExportCode = async () =>
    {
        /* JSON */
        if(true) {
            this.log('Writing to file: ' + this.oOptions.dest + this.oFiles.json);
            this.success('wrote ' + this.exportContentJson.split('\n').length + ' lines');
            if (this.exportContentJson.split('\n').length <= 0) {
                this.warn('no lines written');
            }
    
            grunt.file.write(this.oOptions.dest + this.oFiles.json, this.exportContentJson);
        }

        /* PHP */
        if(true) {
            this.log('Writing to file: ' + this.oOptions.dest + this.oFiles.php);
            this.success('wrote ' + this.exportContentPhp.split('\n').length + ' lines');
            if (this.exportContentPhp.split('\n').length <= 0) {
                this.warn('no lines written');
            }
    
            grunt.file.write(this.oOptions.dest + this.oFiles.php, this.exportContentPhp);
        }
    }


    /**
     * Build the export form body.
     * 
     * @param {array} aNonce 
     * @param {array} aNodes 
     * @param {string} sGenerate 
     * @param {bool} bJson
     *  
     * @returns {string}
     */
    this.buildAcfExportFormbody = (aNonce, aNodes, sGenerate, bJson = false) =>
    {
        sGenerate = sGenerate || "Erstelle+Export+Code";

        let sBody = '';
        if(true === bJson) {
            sBody = '_acf_nonce' + '=' + aNonce + '&action=download&';
        }
        else {
            sBody = '_acf_nonce' + '=' + aNonce + '&tool=export&';
        }

        /* Get all posts' values */
        aNodes = aNodes.map((iIndex, oElement) => oElement.attribs.value);

        let sMessage = '';

        if(true === bJson) {
            this.debuglog("Build export form for JSON");
            sBody += 'keys=';
            sMessage = 'The following ' + aNodes.length + ' ACF field groups\n';
            for (let i = 0; i < aNodes.length; i++) {
                const oElement = aNodes[i];
                sBody += '&keys%5B%5D=' + oElement;
                sMessage += '     #' + oElement + '\n';
            }

            sBody += "&action=download";

            this.logSuccess(sMessage + ' added successfully!', true);
        }
        else {
            this.debuglog("Build export form for PHP");
            sBody += 'keys=';
            sMessage = 'The following ' + aNodes.length + ' ACF field groups\n';
            for (var i = 0; i < aNodes.length; i++) {
                const oElement = aNodes[i];
                sBody += oElement + "+";
                sMessage += '     #' + oElement + '\n';
            }

            sBody = sBody.substring(0, sBody.length - 1);
            sBody += "&generate=" + sGenerate;

            this.logSuccess(sMessage + '   added successfully!', true);
        }

        return sBody;
    }

    /**
     * Parses the version number from a string.
     * Returns an array containing the matched version digits.
     * 
     * @param  {string} sText
     * 
     * @return {array}
     */
    this.parseAcfVersionNumber = (sText) =>
    {
        const aMatched = sText.match(/\d+\.\d+\.*\d+/);

        if (aMatched.length > 0 && (3 === aMatched[0].split('.').length || 2 === aMatched[0].split('.').length)) {
            return aMatched[0].split('.');
        }

        throw this.oErrors.couldNotParseVersion;
    };

    /**
     * Adds a TLS certificate to the given agent, if it's 
     * defined as "cert" in the Gruntfile configuration 
     * and returns the given agent's reference.
     * 
     * @author Michael Bindig <mbi@sopg.de>
     * @jira SOPGGEN-574
     * 
     * @created 2022-10-06
     * 
     * @param {superagent} oAgent
     * 
     * @returns {superagent}
     */
    this.maybeAddTlsCertificate = (oAgent) =>
    {
        /* Get the path to the certificate 
        file from Gruntfile configuration. */
        var certFile = grunt.config().cert || '';

        if ('' !== certFile) {

            if (grunt.file.exists(certFile) && oAgent) {

                /* Get the contents of 
                the certificate file. */
                var cert = fs.readFileSync(certFile);

                /* Add the TLS certificate 
                contents to the given agent. */
                oAgent.ca(cert);
            }
        }

        return oAgent;
    };


    /**
     * Logs a Grunt ACF success.
     * 
     * @param {String} sMessage
     * @param {bool} bWithoutNewLine
     * 
     * @returns {undefined}
     */
    this.logSuccess = (sMessage, bWithoutNewLine) =>
    {
        this.log('╚► ' + sMessage);
        
        if (true !== bWithoutNewLine) {
            this.log('');
        }
    };

    /**
     * Logs a Grunt ACF action.
     * 
     * @param {String} sMessage
     * 
     * @returns {undefined}
     */
    this.logAction = (sMessage) =>
    {
        this.log('╔' + '═'.repeat(sMessage.length + 2) + '╗');
        this.log('║ ' + sMessage + ' ║');
        this.log('╚' + '═'.repeat(sMessage.length + 2) + '╝');
    };

    /**
     * Log a warning.
     * 
     * @param {string} sMessage 
     */
    this.warn = (sMessage) =>
    {
        grunt.log.writeln('warning: '['red'].bold + sMessage['red'].inverse);
    };

    /**
     * Log a success.
     * 
     * @param {string} sMessage 
     */
    this.success = (sMessage) =>
    {
        grunt.log.writeln(sMessage['green'].inverse);
    };

    /**
	 * Debug log
	 * 
	 * @param {mixed} mArgs 
	 */
	this.debuglog = (mArgs) =>
	{
		if(true === this.bDebug) {
			console.log(mArgs);
		}
	};


    this.init();
};

module.exports = acfExport;
