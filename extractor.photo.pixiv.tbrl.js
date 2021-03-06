// ==Taberareloo==
// {
//   "name"        : "Photo Extractor for pixiv"
// , "description" : "Extract a pixiv photo"
// , "include"     : ["content"]
// , "match"       : ["http://www.pixiv.net/member_illust.php?*"]
// , "version"     : "0.0.2"
// , "downloadURL" : "https://raw.githubusercontent.com/eru/extractor.photo.pixiv.tbrl.js/master/extractor.photo.pixiv.tbrl.js"
// }
// ==/Taberareloo==

(function() {
  Extractors.register({
    name           : 'Photo - pixiv',
    ICON           : 'http://www.pixiv.net/favicon.ico',
    REFERRER       : 'http://www.pixiv.net/',
    PAGE_URL       : 'http://www.pixiv.net/member_illust.php?mode=medium&illust_id=',
    DIR_IMG_RE     : new RegExp(
      '^https?://(?:[^.]+\\.)?pixiv\\.net/' +
        'img\\d+/(?:works/\\d+x\\d+|img)/[^/]+/' +
        '(?:mobile/)?(\\d+)(?:_p(\\d+)|_[^_]+)*\\.'
    ),
    DATE_IMG_RE    : new RegExp(
      '^https?://(?:[^.]+\\.)?pixiv\\.net/' +
        '(?:c/\\d+x\\d+/img-master|img-inf|img-original)' +
        '/img/\\d+/\\d+/\\d+/\\d+/\\d+/\\d+' +
        '/(\\d+)(?:-[\\da-f]{32})?(?:_(?:p|ugoira)(\\d+))?'
    ),
    IMG_PAGE_RE    : /^https?:\/\/(?:[^.]+\.)?pixiv\.net\/member_illust\.php/,
    // via http://help.pixiv.net/171/
    IMG_EXTENSIONS : ['jpg', 'png', 'gif', 'jpeg'],
    FIRST_BIG_P_ID : 11320785,
    check : function (ctx) {
      return !ctx.selection && this.getIllustID(ctx);
    },
    extract : function (ctx) {
      var that = this, retry = true;

      return this.getMediumPage(ctx).then(function getImage(info) {
        var imageURL = info.imageURL,
          pageTitle = info.pageTitle,
          illustID = info.illustID;

        return downloadFile(imageURL, {
          referer : that.REFERRER
        }).then(function (file) {
          ctx.title = pageTitle;
          ctx.href = that.PAGE_URL + illustID;

          return {
            type      : 'photo',
            item      : pageTitle,
            itemUrl   : imageURL,
            fileEntry : file
          };
        }).catch(function (err) {
          // when image extension is wrong
          if (retry) {
            retry = false;

            if (that.DATE_IMG_RE.test(info.imageURL)) {
              return that.fixImageExtensionFromList(info).then(getImage);
            }
          }

          throw new Error(err);
        });
      });
    },
    getIllustID : function (ctx) {
      var imageURL = (ctx.onImage && ctx.target.src) || '',
        backgroundImageURL = (ctx.hasBGImage && ctx.bgImageURL) || '',
        targetURL = (ctx.onLink && ctx.linkURL) || ctx.href || '';

      for (var url of [imageURL, backgroundImageURL, targetURL]) {
        if (this.DIR_IMG_RE.test(url) || this.DATE_IMG_RE.test(url)) {
          return url.extract(
            this.DIR_IMG_RE.test(url) ? this.DIR_IMG_RE : this.DATE_IMG_RE
          );
        }
      }

      if (
        this.isImagePage(ctx.link) || (
          !imageURL && targetURL === ctx.href &&
          this.isImagePage(ctx) &&
          (this.getImageElement(ctx) || this.isUgoiraPage(ctx))
        )
      ) {
        var queries = queryHash((new URL(targetURL)).search);
        return queries.illust_id ? queries.illust_id : null;
      }
    },
    getMediumPage : function (ctx) {
      var that = this,
        illustID = this.getIllustID(ctx);

      return request(this.PAGE_URL + illustID, {
        responseType : 'document'
      }).then(function (res) {
        return that.getInfo(ctx, illustID, res.response);
      });
    },
    getInfo : function (ctx, illustID, doc) {
      var isUgoira = this.isUgoiraPage({document : doc}),
        img = this.getImageElement({document : doc}, illustID),
        url = img ? (img.src || img.dataset.src) : '',
        info = {
          imageURL  : url,
          pageTitle : doc.title,
          illustID  : illustID
        };

      if (!img || (!this.DIR_IMG_RE.test(url) && !this.DATE_IMG_RE.test(url))) {
        // for limited access about mypixiv & age limit on login, and delete
        throw new Error(chrome.i18n.getMessage('error_http404'));
      }

      return update(info, {
        imageURL : this.DATE_IMG_RE.test(url) && !isUgoira && /\/img-inf\//.test(url) ?
          this.getLargeThumbnailURL(url) :
          (this.getFullSizeImageURL(ctx, info, isUgoira) || url)
      });
    },
    isImagePage : function (target, mode) {
      if (target && this.IMG_PAGE_RE.test(target.href)) {
        var queries = queryHash(target.search);

        if (queries.illust_id && (mode ? queries.mode === mode : queries.mode)) {
          return true;
        }
      }

      return false;
    },
    isUgoiraPage : function (ctx) {
      return Boolean(ctx.document.querySelector('._ugoku-illust-player-container'));
    },
    getImageElement : function (ctx, illustID) {
      var currentIllustID = illustID || queryHash(ctx.search).illust_id,
          anchor = `a[href*="illust_id=${currentIllustID}"]`;

      return ctx.document.querySelector([
        // mode=medium on login
        anchor + ' > div > img',
        '.works_display > div > img',
        // mode=big and mode=manga_big on login
        'body > img:only-child',
        // mode=manga
        'img.image',
        // book(mode=manga)
        'div.image > img',
        // non-r18 illust on logout
        '.cool-work-main > .img-container > a.medium-image > img',
        // r18 on logout
        '.cool-work-main > .sensored > img',
        // ugoira on logout
        anchor + ` > img[src*="${currentIllustID}"]`
      ].join(', '));
    },
    getFullSizeImageURL : function (ctx, info, isUgoira) {
      var cleanedURL = this.getCleanedURL(info.imageURL);

      if (isUgoira) {
        var urlObj = new URL(cleanedURL);

        urlObj.pathname = urlObj.pathname.replace(
          /^\/c\/\d+x\d+\/img-master\/|\/img-inf\//,
          '/img-original/'
        ).replace(
          /(\/\d+(?:-[\da-f]{32})?_)[^.\/]+\./,
          `$1ugoira${this.getPageNumber(ctx)}.`
        );

        return urlObj.toString();
      }

      // for manga, illust book
      if (!(
        this.DIR_IMG_RE.test(cleanedURL) &&
          /(?:のイラスト|」イラスト\/.+?) \[pixiv\](?: - [^ ]+)?$/.test(info.pageTitle)
      )) {
        var pageNum = this.getPageNumber(ctx);

        if (this.DIR_IMG_RE.test(cleanedURL)) {
          return cleanedURL.replace(
            /img\/[^\/]+\/\d+(?:_[\da-f]{10})?/,
            '$&_' + (
              this.FIRST_BIG_P_ID > info.illustID ? '' : 'big_'
            ) + 'p' + pageNum
          );
        }
        if (this.DATE_IMG_RE.test(cleanedURL)) {
          return cleanedURL.replace(
            /(\/\d+(?:-[\da-f]{32})?_p)\d+/,
            '$1' + pageNum
          );
        }
      }

      return cleanedURL;
    },
    getCleanedURL : function (url) {
      var urlObj = new URL(url),
        pathname = urlObj.pathname;

      if (this.DIR_IMG_RE.test(url)) {
        pathname = pathname
          .replace(/works\/\d+x\d+/, 'img')
          .replace(/(img\/[^\/]+\/)(?:mobile\/)?(\d+(?:_[\da-f]{10})?)(?:_[^.]+)?/, '$1$2');
      } else if (
        this.DATE_IMG_RE.test(url) &&
          /^\/c\/\d+x\d+\/img-master\//.test(pathname) &&
          /\/\d+(?:-[\da-f]{32})?_p\d+_(?:master|square)\d+\./.test(pathname)
      ) {
        pathname = pathname
          .replace(/^\/c\/\d+x\d+\/img-master\//, '/img-original/')
          .replace(/(\/\d+(?:-[\da-f]{32})?_p\d+)_(?:master|square)\d+\./, '$1.');
      }

      urlObj.pathname = pathname;

      return urlObj.toString();
    },
    getPageNumber : function (ctx) {
      var that = this,
        imageURL = ctx.onImage ? ctx.target.src : (ctx.hasBGImage ? ctx.bgImageURL : ''),
        targetURL = ctx.onLink ? ctx.linkURL : ctx.href;

      return (function() {
        for (var url of [imageURL, targetURL]) {
          if (url) {
            var urlObj = new URL(url);

            if (that.DIR_IMG_RE.test(url)) {
              return url.extract(that.DIR_IMG_RE, 2);
            }
            if (that.DATE_IMG_RE.test(url)) {
              return url.extract(that.DATE_IMG_RE, 2);
            }
            if (that.isImagePage(urlObj, 'manga_big')) {
              return urlObj.searchParams.get('page');
            }
          }
        }
      })() || '0';
    },
    getLargeThumbnailURL : function (url) {
      var urlObj = new URL(url),
        pathname = urlObj.pathname;

      urlObj.pathname = pathname.replace(/(\/\d+(?:_[\da-f]{10})?_)[^_.]+\./, '$1s.');

      return urlObj.toString();
    },
    fixImageExtensionFromList : function (info) {
      var that = this,
        uri = info.imageURL,
        extension = getFileExtension(uri),
        regExtension = new RegExp(extension + '$'),
        extensions = this.IMG_EXTENSIONS.filter(function removeCurrent(candidate) {
          // `this` type is "object", not "string".
          return String(this) !== candidate;
        }, extension);

      return (function recursive() {
        var fileExtension = extensions.shift(),
          imageURL = uri.replace(regExtension, fileExtension);

        return downloadFile(imageURL, {
          referer : that.REFERRER
        }).then(function() {
          info.imageURL = imageURL;

          return info;
        }).catch(function() {
          if (extensions.length) {
            return recursive();
          }

          throw new Error(chrome.i18n.getMessage('error_http404'));
        });
      }());
    },
    getLocalCookie : function (c_name) {
      var c_value = document.cookie;
      var c_start = c_value.indexOf(' ' + c_name + '=');
      if (c_start === -1) {
        c_start = c_value.indexOf(c_name + '=');
      }
      if (c_start === -1) {
        c_value = null;
      } else {
        c_start = c_value.indexOf('=', c_start) + 1;
        var c_end = c_value.indexOf(';', c_start);
        if (c_end === -1) {
          c_end = c_value.length;
        }
        c_value = decodeURIComponent(c_value.substring(c_start, c_end));
      }
      return c_value;
    },
    getCSVList: function (csv) {
      var frags, results, start, end, doublequote, comma;

      frags = csv.split('');
      results = [];
      start = end = doublequote = 0;
      comma = true;

      for (var i = 0, len = frags.length; i < len; i += 1) {
        var frag = frags[i];

        if (frag === '"') {
          if (start + 1 !== i) {
            if (comma) {
              comma = false;
              start = i;
              results.push(frag);
            } else {
              if (end + 1 === i && doublequote !== end - 1) {
                doublequote = i - 1;
              }

              end = i;
              results[results.length - 1] += frag;
            }
          } else {
            doublequote = i;
            results[results.length - 1] += frag;
          }
        } else if (frag === ',') {
          if (start < end && doublequote + 1 !== end) {
            if (comma) {
              results.push('');
            } else {
              comma = true;
            }
          } else {
            results[results.length - 1] += frag;
          }
        } else {
          results[results.length - 1] += frag;
        }
      }
      return results;
    }
  }, 'Photo');
})();
