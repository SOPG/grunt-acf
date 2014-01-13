# grunt-acf

> Exports [AdvancedCustomFields](http://www.advancedcustomfields.com/) to PHP. Grunt acts like a headless browser to fetch the export code and puts it into your destination file



## Getting Started
This plugin requires Grunt `~0.4.0`

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install grunt-acf --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('grunt-acf');
```


*This plugin was designed to work with Grunt 0.4.x. If you're still using grunt v0.3.x it's strongly recommended that [you upgrade](http://gruntjs.com/upgrading-from-0.3-to-0.4), but in case you can't please use [v0.3.2](https://github.com/gruntjs/grunt-contrib-copy/tree/grunt-0.3-stable).*

## acf task
_Run this task with the `grunt acf` command._

Task targets, files and options may be specified according to the grunt [Configuring tasks](http://gruntjs.com/configuring-tasks) guide.
### Options

#### baseUrl
Type: `String`
default: `undefined`

This is your projects local URL. We need this to login.

#### user 
Type: `String`
default `undefined`

This is your wordpress user. It should have access to the ACF-Admin panel. 

#### password
Type: `String`
default `undefined`

This is the password for you wordpress user.

#### addons
Type: `Object`
default `false`

Whether we'd like to enable loading the plugins automatically.

#### dest
Type: `String`
default `none`

The Path to your export file

#### condition
Type: `String`
default `none`

You can add extra-loading logic to ACF Export. It has to be valid PHP. It will be rendered inside if brackets. `if( <condition>){ [..ACF Fields..] }`

```js
options: {
	baseUrl: 'myproject.dev',
	user: 'wpAdminUser',
	password: 'wpAdminPW123!!11',
	condition: "defined('my_environment') && my_environment === 'live'",
	addons: {
		repeater: true,
		gallery: true,
		flexible: true,
		options: true,
	}
},
dest: '<%= cfg.themeDir %>/library/acf-export.php'
```