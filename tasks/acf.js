module.exports = function(grunt){
	var	http = require('superagent'),
		cheerio = require('cheerio');

	// the main task
	grunt.registerMultiTask('acf', 'exports ACF fields', function(ff){
		var gruntDone = this.async(),
			self = this,
			options = this.options({
				encoding: grunt.file.defaultEncoding,
			});

		self.agent = http.agent();

		// do the login
		self.agent.post("http://" + options.baseUrl + '/wp-login.php')
			.set('Host', options.baseUrl)
			.set('Origin', "http://"+options.baseUrl)
			.set('Referer', "http://"+options.baseUrl + '/wp-login.php')
			.type('form')
			.send({
				log: options.user,
				pwd: options.password
			})
			.end(function(err, res1){
				
				var $ = cheerio.load(res1.text);

				// was the login succesful ?
				if( $('#loginform').length === 0 ){
					// successful
					console.log('...logged into WP Backend');
				}else{
					// not successful
					throw "could not login.";
				}
				
				// query for the acf-export page to get the nonce 
				self.agent.get("http://" + options.baseUrl + '/wp-admin/edit.php?post_type=acf&page=acf-export')
					.set('Host', options.baseUrl)
					.set('Origin', "http://"+options.baseUrl)
					.set('Referer', "http://"+options.baseUrl + '/wp-login.php')
					.end(function(err, res2){
						var $ = cheerio.load(res2.text);
						var nonce = $('#wpbody-content .wrap form input[name="nonce"]');
						var posts = $('form table select').children();
						posts = posts.map(function(i, el){ return el.attribs.value; });
						
						// #WTF? why are we on the login page?
						if( $('#loginform').length === 1 ){
							// could be misconfigured.
							throw "internal error. WP redirect incoming.";
						}

						// no nonce found.
						if(nonce.length === 0){
							throw "no nonce found @ WP-ACF export Page";
						}else{
							console.log('...found nonce @ ACF-Export Page');
							// yey, got one!
							var ACFnonce = nonce[0].attribs.value;

							// build POST data string
							var postString = "nonce="+ACFnonce+"&acf_posts=&";
							i = 0;
							while(true){
								if(posts[i]){
									console.log("...adding post #"+posts[i]);
									postString += encodeURIComponent("acf_posts[]="+posts[i])+"&";
									//console.log('adding: ' + posts[i]);

								}else{
									break;
								}
								i++;
							}
							postString += "&export_to_php=Export+als+PHP";

							// query for the same page, but w/ POST & nonce
							var request = self.agent.post("http://"+options.baseUrl+"/wp-admin/edit.php?post_type=acf&page=acf-export");
								request.type("form");
								request.send(postString);
								request.end(function(err, res3){
									if(err) throw err;
									$ = cheerio.load(res3.text);

									var textarea = $('#wpbody-content textarea');
									var ACFcontents = "<?php \n" + textarea.text();
									
									if(textarea.length > 0 && ACFcontents.length > 0){
										console.log('...found PHP Export data');
										
										if(options.addons){
											console.log('...activating addons addons');
											// replace addons strings
											options.addons.repeater ? ACFcontents = ACFcontents.replace("// include_once('add-ons/acf-repeater/acf-repeater.php');", "include_once( ABSPATH . '/wp-content/plugins/acf-repeater/acf-repeater.php');") : '';
											options.addons.gallery ? ACFcontents = ACFcontents.replace("// include_once('add-ons/acf-gallery/acf-gallery.php');", "include_once( ABSPATH . '/wp-content/plugins/acf-gallery/acf-gallery.php');") : '';
											options.addons.flexible ? ACFcontents = ACFcontents.replace("// include_once('add-ons/acf-flexible-content/acf-flexible-content.php');", "include_once( ABSPATH . '/wp-content/plugins/acf-flexible-content/acf-flexible-content.php');") : '';
											options.addons.options ? ACFcontents = ACFcontents.replace("// include_once( 'add-ons/acf-options-page/acf-options-page.php' );", "include_once( ABSPATH . '/wp-content/plugins/acf-options-page/acf-options-page.php');") : '';
										}

										if(options.condition){
											ACFcontents = ACFcontents.replace('if(function_exists("register_field_group"))', 'if(function_exists("register_field_group") && '+options.condition+' )');
										}

										console.log('...writing to file: ' + self.files[0].dest);
										console.log( "..."+ACFcontents.split("\n").length + ' lines');
										grunt.file.write(self.files[0].dest, ACFcontents);
									}else{
										//console.log(res3.text);
										throw "Could not POST the ACF-Export page. / No textarea found / No text inside it.";
									}
									gruntDone();
								});
						}
					});
			});
	});
};

