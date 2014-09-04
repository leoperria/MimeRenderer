'use strict';
var MailComposer = require("mailcomposer").MailComposer;
var log4js = require('log4js');
var logger = log4js.getLogger("Email");
var mimelib = require("mimelib");
var MailParser = require("mailparser").MailParser;
var path = require('path');


/*
 Email
 
 Creates and render a MIME message starting from its components
 Uses mailcomposer libs
 
 @author Leonardo Perria
 
 */
 
Email.rawMessage = String();
Email.from = undefined;
Email.toList = [];
Email.ccList = [];
Email.bccList = [];
Email.subject = String();
Email.content = String();
Email.htmlContent = String();
Email.senderIp = String();
Email.messageId = String();
Email.senderAccountId = String();
Email.customHeaders = {};
Email.constants = {
    maxSubjectChars:700,
    modes:{
        rawMessage:0,
        parametersMessage:1
    }
};

function Email(accountID, req) {
    this.mailcomposer = new MailComposer();
    this.mailparser = new MailParser();

    // parameters from request
    this.senderAccountId = String(accountID);
    this.from = mimelib.parseAddresses(req.param('from'))[0];
    this.toList = mimelib.parseAddresses(req.param('to'));
    this.ccList = mimelib.parseAddresses(req.param('cc'));
    this.bccList = mimelib.parseAddresses(req.param('bcc'));
    this.senderIp = String(req.connection.remoteAddress);
    this.messageId = null;
    this.subject = (req.param('subject')) ? String(req.param('subject')) : '';
    if (req.param('mime_raw')) {
        this.rawMessage = req.param('mime_raw') || '';
        this.mode = Email.constants.modes.rawMessage;
    } else {
        this.content = String(req.param('content'));
        this.htmlContent = String(req.param('html_content'));
        this.mode = Email.constants.modes.parametersMessage;
    }
    try {
        this.customHeaders = req.param('custom_headers') && JSON.parse(req.param('custom_headers'));
    } catch (exception) {
        this.customHeaders = "not valid";
    }
}

/*
 Validate email object
 */
Email.prototype.validate = function () {
    var errors = []
        , result
        , listsAndErrorMessages = [
            ['toList', "'to' email not valid"],
            ['bccList', "'bcc' email not valid"],
            ['ccList', "'cc' email not valid"]
        ];
    if (this.subject.length > Email.constants.maxSubjectChars)
        errors.push("subject too long (max " + Email.constants.maxSubjectChars + " chars )");
    if (!this.from || !validateEmail(this.from))
        errors.push("missing or not valid sender email (from)");
    if (this.toList.length == 0)
        errors.push('missing recipients (to)');
    for (var key in listsAndErrorMessages) {
        var listName = listsAndErrorMessages[key][0];
        var errorMessage = listsAndErrorMessages[key][1];
        result = this.checkAndFilterEmailList(listName, errorMessage);
        this[listName] = result.list;
        if (result.errors.length > 0)
            errors.push(result.errors);
    }
    if (this.customHeaders === "not valid")
        errors.push("headers not valid");

    if (errors.length > 0)
        return {status:"error", errors:errors};
    else
        return {status:"ok"};
};

/*
 Generate mime message of email object
 */
Email.prototype.generateMimeMessage = function (callBack) {
    var self = this;
    switch (this.mode) {
        case Email.constants.modes.parametersMessage:
            self.manageParametersMode(callBack);
            break;
        case Email.constants.modes.rawMessage:// MIME PARAMETER PASSED BY USER
            self.manageRawMode(callBack);
            break;
        default:
            callBack(new Error('Neither html_content (and optional content) OR mime_raw message was passed'), null); // error case
    }
};

/*
 validate email address list
 */
Email.prototype.checkAndFilterEmailList = function (emailListName, errorMessage) {
    var errors = []
        , filteredList = [];
    for (var i in this[emailListName]) {
        var email = this[emailListName][i];
        if (email.address.length > 0) {
            if (validateEmail(email)) {
                filteredList.push(email);
            } else {
                errors.push("'" + email.address + "' " + errorMessage);
            }
        }
    }
    return {errors:errors, list:filteredList};
};

/*
 Return a list of all addresses in toList,ccList and bccList avoiding duplicates
 */
Email.prototype.getAllAddressesUnique = function () {
    var list = extractAddressList(this.toList);
    if (this.bccList && this.bccList.length > 0)
        list = list.concat(extractAddressList(this.bccList));
    if (this.ccList && this.ccList.length > 0)
        list = list.concat(extractAddressList(this.ccList));
    //avoid duplicates
    return list.filter(function (elem, pos, self) {
        return self.indexOf(elem) == pos;
    });
};

/*
 remove any email object with address not present in validAddressList from
 toList, ccList, bccList
 */
Email.prototype.filterAddresses = function (validAddressList) {
    this.toList = this.toList.filter(function (element, index, array) {
        return validAddressList.indexOf(element.address) > -1;
    });
    this.ccList = this.ccList.filter(function (element, index, array) {
        return validAddressList.indexOf(element.address) > -1;
    });
    this.bccList = this.bccList.filter(function (element, index, array) {
        return validAddressList.indexOf(element.address) > -1;
    });
};

/*
 Add an header to mime mode headers array
 */
Email.prototype.addHeaderIfPresent = function (key, value) {
    if (value) {
        this.mimeModeHeaders.push([key, value]);
    }
};

/*
 Add an address header to mime mode headers array
 */
Email.prototype.addAddressHeaderIfPresent = function (key, value) {
    if (value) {
        this.mimeModeHeaders.push([key, (Object.prototype.toString.call(value) === '[object Array]' ) ? buildMimeAddressList(value) : buildMimeAddress(value)]);
    }
};

/*
 Generate mime message in parameters mode
 */
Email.prototype.manageParametersMode = function(callBack){
    var self = this;
    this.mailcomposer.setMessageOption({
        from:buildMimeAddress(this.from),
        to:buildMimeAddressList(this.toList),
        bcc:(this.bccList) ? buildMimeAddressList(this.bccList) : '',
        cc:(this.ccList) ? buildMimeAddressList(this.ccList) : '',
        body:(this.content) ? this.content : '',
        html:(this.htmlContent) ? this.htmlContent : '',
        subject:(this.subject) ? this.subject : ''
    });
    if (this.customHeaders && typeof this.customHeaders === 'object') {
        var customHeadersKeys = Object.keys(this.customHeaders);
        for (var key in customHeadersKeys)
            self.mailcomposer.addHeader(customHeadersKeys[key], this.customHeaders[customHeadersKeys[key]]);
    }
    self.mailcomposer.buildMessage(callBack);
};

/*
 Generate mime message using parameters and mime from user
 */
Email.prototype.manageRawMode = function(callBack){
    var self = this;
    //1. divide header and body parts
    var lines = this.rawMessage.split(/\r?\n|\r/);
    var delimiterIndex = getDelimiterIndex(lines);
    if (delimiterIndex == -1) {
        // delimiter not present
        return callBack(true, null);
    }
    var headerLines = lines.splice(0, delimiterIndex);
    var headerString = headerLines.join('\r\n').concat("\r\n");
    var bodyString = lines.join('\r\n');
    //2. parse header part
    self.mimeModeHeaders = [];
    self.addHeaderIfPresent("MIME-Version", "1.0");
    self.addAddressHeaderIfPresent('from', self.from);
    self.addAddressHeaderIfPresent('to', self.toList);
    self.addAddressHeaderIfPresent('cc', self.ccList);
    self.addHeaderIfPresent('subject', self.subject);
    if (self.customHeaders && typeof self.customHeaders === 'object') {
        var customHeadersKeys = Object.keys(self.customHeaders);
        for (var key in customHeadersKeys)
            self.addHeaderIfPresent(customHeadersKeys[key], self.customHeaders[customHeadersKeys[key]]);
    }
    self.mailparser.write(headerString);
    self.mailparser.end();
    self.mailparser.on("end", function mailParserCallback(headerObject) {
        for (var key in headerObject)
            if (key == "headers")
                for (var header in headerObject['headers'])
                    if (headerObject['headers'][header] && header != "message-id" && header != "messageId")
                        switch (header) {
                            case "to":
                            case "from":
                            case "cc":
                            case "bcc":
                            case "subject":
                            case "mime-version":
                                // do nothing
                                break;
                            default:
                                self.addHeaderIfPresent(header, headerObject['headers'][header]);
                        }
        var messageSource = String();
        //3. generate new header string
        for (var i = 0; i < self.mimeModeHeaders.length; i++)
            messageSource += self.mimeModeHeaders[i][0] + ": " + self.mimeModeHeaders[i][1] + "\r\n"; // concat key and value header
        //4. concat header created and body sended by user
        var mimeMessage = messageSource.concat("\r\n" + bodyString);
        //5. return complete mime string
        callBack(null, mimeMessage);
    });
};

/**
 * Scan an array of lines returning the index of the first blank line
 *
 * @param lines
 * @return {Number}
 */
var getDelimiterIndex = function (lines) {
    for (var i = 0; i < lines.length; i++) {
        if (!lines[i].length)
            return i;
    }
    return -1;
};

/**
 * Build a list of comma separated email address from emailList=[ {address:'demo@email.com',name:'Name'},...]
 *
 * Outputs: Name <demo@email.com>, Name1 <demo1@email.com>, ...
 *
 * Handles case of name==''
 *
 * @param emailList
 * @return {String}
 */
var buildMimeAddressList = function (emailList) {
    if (emailList) {
        var values = [], email;
        for (var i = 0; i < emailList.length; i++) {
            email = emailList[i];
            if (email.address) {
                values.push(buildMimeAddress(email));
            }
        }
        return values.join(", ");
    } else
        return String();
};

/*
 convert address object to string
 */
var buildMimeAddress = function (email) {
    if (email) {
        if (!email.name) {
            return email.address;
        } else {
            return '"' + email.name + '" <' + email.address + '>';
        }
    }
    return null;
};

/*
 return a list of addresses from an email list
 */
var extractAddressList = function (emailList) {
    if (emailList)
        return emailList.map(function (el) {
            return el.address;
        });
    else
        return null;
};

/*
 Validate an email address
 */
var validateEmail = function (email) {
    var emailRegExp = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return emailRegExp.test(email.address);
};

/*
 Covert mimelib address object to string
 */
var getEmailAddressStringFromObject = function (object) {
    if (object) {
        if (object.constructor == Array) {
            console.log('getEmailAddressStringFromObject ADDRESS CASE');
            var listString = String();
            for (var key in object) {
                listString += object[key].name + ' ' + object[key].address + ','
            }
            return listString.substring(0, listString.length - 1);
        } else {
            console.log('getEmailAddressStringFromObject STRING CASE');
            return  object.name + ' ' + object.address;
        }
    }
};

/*
 Remove Last lines in a string
 */
var removeLastLinesFromString = function (linesNumber, source) {
    if (source) {
        for (var i = 0; i < linesNumber && source.lastIndexOf("\r\n") > 0; i++)
            source = source.substring(0, source.lastIndexOf("\r\n"));
        return source;
    } else
        return String();
};

module.exports = Email;