"use strict";

if (!global._babelPolyfill) {
  require("babel-polyfill");
}

import "es6-promise/auto";
import "whatwg-fetch";

import PackageJSON from "../package.json";
import EventBus from "./components/EventBus";
import ImplementationTest from "./components/ImplementationTest";
import VideoAd from "./components/VideoAd";
import MessageRouter from "./components/MessageRouter";

import { AdType } from "./modules/adType";
import { SDKEvents, IMAEvents } from "./modules/eventList";
import { dankLog, setDankLog } from "./modules/dankLog";
import {
  extendDefaults,
  getParentUrl,
  getParentDomain,
  getQueryParams,
  getScript,
  getIframeDepth,
  parseJSON,
  getMobilePlatform,
  getTopDomain,
  Ls
} from "./modules/common";
import { Base64 } from "js-base64";
import Macros from "./components/Macros";

const cloneDeep = require("lodash.clonedeep");
const Url = require("url-parse");
const qs = require("querystringify");
const isArray = require("is-array");

import Quantum from "./splash/quantum";
import Mars from "./splash/mars";
import Pluto from "./splash/pluto";
import Hammer from "./promo/hammer";
import Puzzle from "./promo/puzzle";
import isPlainObject from "is-plain-object";

let instance = null;

/**
 * SDK
 */
class SDK {
  constructor(options) {
    // Make this a singleton.
    if (instance) return instance;
    else instance = this;

    // Process options
    this._defaults = this._getDefaultOptions();
    this._extendDefaultOptions(this._defaults, options);

    // get loader context
    this._bridge = this._getBridgeContext();
    // console.log(this._bridge);

    // URL and domain
    this._parentURL = this._bridge.parentURL;
    this._parentDomain = this._bridge.parentDomain;
    this._topDomain = this._bridge.topDomain;

    // Console banner
    this._setConsoleBanner();

    // Load tracking services.
    this._loadGoogleAnalytics();

    // Whitelabel option for disabling ads.
    this._checkWhitelabelPartner();

    this._checkUserDeclinedTracking();

    this._initializeMessageRouter();

    this._checkConsole();

    // Setup all event listeners.
    // We also send a Google Analytics event for each one of our events.
    this._subscribeToEvents();

    // GDPR (General Data Protection Regulation).
    // Broadcast GDPR events to our game developer.
    // They can hook into these events to kill their own solutions.
    this._gdpr();

    // Get the game data once.
    this.sdkReady = new Promise(this._initializeSDKWithGameData.bind(this));
    this.sdkReady
      .then(response => {
        // sdk is ready
        this._sdk_ready = true;
      })
      .catch(error => {
        // sdk has an error
        this._sdk_ready = false;
      })
      .finally(() => {
        this._sendLoaderDataEvent();

        this._sendLoadedEvent();

        this._checkSplashAndPromoScreens();

        this._initBlockingExternals();

        this._pauseGameOnStartupIfEnabled();

        window.addEventListener("DOMNodeInserted", () => {
          if (this._gameData.block_exts) {
            this._removeExternalsInHtml({ enabled: false });
          }
        });
        // window.addEventListener('keydown', (e) => {
        //   if (!e.repeat)
        //     console.log(`Key "${e.key}" pressed  [event: keydown]`);
        //   else
        //   console.log(`Key "${e.key}" repeating  [event: keydown]`);
        // });
      });

  }

  _pauseGameOnStartupIfEnabled() {
    if (this._bridge.pauseGameOnStartup) {
      // this.msgrt.send("gamezone.pause");
    }
  }

  _sendLoaderDataEvent() {
    try {
      this.options.onLoaderEvent({
        name: "LOADER_DATA",
        message: { game: this._gameData, bridge: this._bridge },
        status: this._sdk_ready ? "success" : "error"
      });
    } catch (error) { }
  }

  _sendLoadedEvent() {
    if (this._bridge.noLoadedEvent) return;

    // send play/load event to tunnl
    this._sendTunnlEvent(1);

    this.msgrt.send("loaded", {
      message: this._hasBlocker ? "Has Blocker" : "No Blocker"
    });
  }

  async _initializeSDKWithGameData(resolve, reject) {
    try {
      this._gameData = await this._getGameData();

      this._checkGameId();

      this._checkBlocking();

      this._changeMidrollInDebugMode();

      await this._initializeVideoAd();

      this._sendSDKReady();

      resolve(this._gameData);
    } catch (error) {
      this._sendSDKError(error);

      // Just resume the game.
      this.onResumeGame(error.message, "warning");

      // Something went wrong.
      reject(error);
    }
  }

  _getDefaultOptions() {
    const defaults = {
      debug: false,
      testing: false,
      gameId: "4f3d7d38d24b740c95da2b03dc3a2333", // Basket and ball
      prefix: "gdsdk__",
      onEvent: function (event) {
        // ...
      },
      onLoaderEvent: function (event) {
        // ...
      },
      /**
       * [DEPRECATED]
       * Properties and callbacks used for Flash games and older HTML5 implementations.
       */
      flashSettings: {
        adContainerId: "",
        splashContainerId: ""
      },
      advertisementSettings: {},
      resumeGame: function () {
        // ...
      },
      pauseGame: function () {
        // ...
      },
      onInit: function (data) {
        // ...
      },
      onError: function (data) {
        // ...
      },
      loader: {}
    };

    return defaults;
  }

  _extendDefaultOptions(defaults, options) {
    let target = cloneDeep(defaults);
    if (options) this.options = extendDefaults(target, options);
    else this.options = target;

    this.options.gameId = this.options.gameId.trim();
  }

  _setConsoleBanner() {
    if (this._bridge.noConsoleBanner) return;

    // Set a version banner within the developer console.
    const version = PackageJSON.version;
    const banner = console.log(
      "%c %c %c GameDistribution.com HTML5 SDK | Version: " +
      version +
      " %c %c %c",
      "background: #9854d8",
      "background: #6c2ca7",
      "color: #fff; background: #450f78;",
      "background: #6c2ca7",
      "background: #9854d8",
      "background: #ffffff"
    );

    console.log.apply(console, banner);
  }

  _sendTunnlEvent(eventType) {
    // 1: play/load
    // new Image().src = `https://ana.tunnl.com/event?page_url=${encodeURIComponent(getParentUrl())}&game_id=${this.options.gameId}&eventtype=${1}`;
    fetch(`https://ana.tunnl.com/event?page_url=${encodeURIComponent(this._parentURL)}&game_id=${this.options.gameId}&eventtype=${eventType}`);
  }

  _sendAdRequestContext(context) {
    // console.log(context);
    this.msgrt.send('adctx', { message: context.adTag.bidder });
    // this.msgrt.send('adfp', { message: context.adTag.price });
  }

  _checkWhitelabelPartner() {
    // Whitelabel option for disabling ads.
    this._whitelabelPartner = false;
    const xanthophyll = getQueryParams("xanthophyll");
    if (
      xanthophyll.hasOwnProperty("xanthophyll") &&
      xanthophyll["xanthophyll"] === "true"
    ) {
      this._whitelabelPartner = true;
      dankLog("White label publisher", `${this._whitelabelPartner}`, "success");
    }
  }

  _checkConsole() {
    try {
      if (!Ls.available) return;

      // Enable debugging if visiting through our developer admin.
      if (this._parentDomain === "developer.gamedistribution.com") {
        Ls.set("gd_debug_ex", true);
        Ls.set("gd_disable_midroll_timer", true);
        Ls.set("gd_tag", true);
      } else if (this._parentDomain === "localhost:3000") {
        Ls.set("gd_debug_ex", true);
        Ls.set("gd_disable_midroll_timer", true);
      }

      // Open the debug console when debugging is enabled.
      if (Ls.getBoolean("gd_debug_ex")) {
        this.openConsole();

        this.msgrt.send("dev.console", {
          message: this._parentDomain
        });
      }
    } catch (error) { }
  }

  _checkUserDeclinedTracking() {
    this._userDeclinedTracking =
      document.location.search.indexOf("gdpr-tracking=0") >= 0 ||
      document.cookie.indexOf("ogdpr_tracking=0") >= 0;
  }

  _initializeMessageRouter() {
    // Message router initialization
    this.msgrt = new MessageRouter({
      gameId: this.options.gameId,
      hours: new Date().getHours(),
      topDomain: this._topDomain,
      domain: this._parentDomain,
      referrer: this._parentURL,
      depth: getIframeDepth(),
      version: PackageJSON.version,
      tracking: this._userDeclinedTracking,
      whitelabel: this._whitelabelPartner,
      platform: getMobilePlatform(),
      byloader: this._bridge.isTokenGameURL,
      isTokenGameURL: this._bridge.isTokenGameURL,
      isMasterGameURL: this._bridge.isMasterGameURL,
      isExtHostedGameURL: this._bridge.isExtHostedGameURL,
      byloaderVersion: this._bridge.version
    });
  }

  _loadGoogleAnalytics() {
    const userDeclinedTracking =
      document.location.search.indexOf("gdpr-tracking=0") >= 0 ||
      document.cookie.indexOf("ogdpr_tracking=0") >= 0;
    const googleScriptPaths = ["https://www.google-analytics.com/analytics.js"];

    // Load Google Analytics.
    getScript(googleScriptPaths[0], "gdsdk_google_analytics", {
      alternates: googleScriptPaths,
      error_prefix: "Blocked:",
      exists: () => {
        return window["ga"];
      }
    })
      .then(() => {
        window["ga"](
          "create",
          "UA-60359297-49",
          {
            name: "gd",
            cookieExpires: 90 * 86400,
            sampleRate: 5 // Specifies what percentage of users should be tracked. This defaults to 100 (no users are sampled out) but large sites may need to use a lower sample rate to stay within Google Analytics processing limits.
          },
          "auto"
        );

        if (!this._bridge.noGAPageView) {
          window["ga"]("gd.send", "pageview");
        }

        // Anonymize IP for GDPR purposes.
        if (!userDeclinedTracking) {
          window["ga"]("gd.set", "anonymizeIp", true);
        }
      })
      .catch(error => {
        this._sendSDKError(error);
      });

    // if (!userDeclinedTracking) {
    //   const lotameScriptPaths = [
    //     "https://tags.crwdcntrl.net/c/13998/cc.js?ns=_cc13998"
    //   ];
    //   getScript(lotameScriptPaths[0], "LOTCC_13998", {
    //     alternates: lotameScriptPaths
    //   })
    //     .then(() => {
    //       if (
    //         typeof window["_cc13998"] === "object" &&
    //         typeof window["_cc13998"].bcpf === "function" &&
    //         typeof window["_cc13998"].add === "function"
    //       ) {
    //         if (!this._bridge.noLotamePageView) {
    //           window["_cc13998"].add("act", "play");
    //           window["_cc13998"].add("med", "game");
    //         }

    //         // Must wait for the load event, before running Lotame.
    //         if (document.readyState === "complete") {
    //           window["_cc13998"].bcpf();
    //         } else {
    //           window["_cc13998"].bcp();
    //         }
    //       }
    //     })
    //     .catch(error => {
    //       this._sendSDKError(error);
    //     });
    // }
  }

  _subscribeToEvents() {
    this.eventBus = new EventBus();

    SDKEvents.forEach(eventName =>
      this.eventBus.subscribe(eventName, event => this._onEvent(event), "sdk")
    );

    this.eventBus.subscribe("AD_SDK_CANCELED",
      () => {
        // this.msgrt.send("ad.cancelled");
      },
      "sdk"
    );

    IMAEvents.forEach(eventName =>
      this.eventBus.subscribe(eventName, event => this._onEvent(event), "ima")
    );
    this.eventBus.subscribe(
      "COMPLETE",
      () => {
        // Do a request to flag the sdk as available within the catalog.
        // This flagging allows our developer to do a request to publish
        // this game, otherwise this option would remain unavailable.
        if (
          this._parentDomain === "developer.gamedistribution.com" ||
          new RegExp("^localhost").test(this._parentDomain) === true
        ) {
          fetch(
            `https://game.api.gamedistribution.com/game/v2/hasapi/${
            this.options.gameId
            }?timestamp=${new Date().valueOf()}`
          );
          try {
            let message = JSON.stringify({
              type: "GD_SDK_IMPLEMENTED",
              gameID: this.options.gameId
            });
            if (window.location !== window.top.location) {
              window.top.postMessage(message, "*");
            } else if (
              window.opener !== null &&
              window.opener.location !== window.location
            ) {
              window.opener.postMessage(message, "*");
            }
          } catch (e) {
            // For some reason, the postmessage didn't work (maybe there is no parent).
            // It's ok though, we have the image fallback
          }
        }
      },
      "ima"
    );
    this.eventBus.subscribe(
      "CONTENT_PAUSE_REQUESTED",
      () =>
        this.onPauseGame("New advertisements requested and loaded", "success"),
      "ima"
    );

    this.eventBus.subscribe(
      "IMPRESSION",
      arg => {
        this.msgrt.send("ad.impression");

        // // Lotame tracking.
        // try {
        //   window["_cc13998"].bcpw("genp", "ad video");
        //   window["_cc13998"].bcpw("act", "ad impression");
        // } catch (error) {
        //   // No need to throw an error or log. It's just Lotame.
        // }
      },
      "ima"
    );

    this.eventBus.subscribe(
      "SKIPPED",
      arg => {
        // // Lotame tracking.
        // try {
        //   window["_cc13998"].bcpw("act", "ad skipped");
        // } catch (error) {
        //   // No need to throw an error or log. It's just Lotame.
        // }
      },
      "ima"
    );

    this.eventBus.subscribe("AD_ERROR",
      arg => {
        this.msgrt.send("ad.error", {
          message: arg.message,
          details: arg.details
        });
      },
      "ima"
    );

    this.eventBus.subscribe("CLICK",
      arg => {
        // this.msgrt.send("ad.click");
        // // Lotame tracking.
        // try {
        //   window["_cc13998"].bcpw("act", "ad click");
        // } catch (error) {
        //   // No need to throw an error or log. It's just Lotame.
        // }
      },
      "ima"
    );

    this.eventBus.subscribe(
      "COMPLETE",
      arg => {
        // this.msgrt.send("ad.complete");

        // // Lotame tracking.
        // try {
        //   window["_cc13998"].bcpw("act", "ad complete");
        // } catch (error) {
        //   // No need to throw an error or log. It's just Lotame.
        // }
      },
      "ima"
    );

    this.eventBus.subscribe(
      "AD_SDK_REQUEST",
      arg => {
        this._sendTunnlEvent(2);
        this._sendAdRequestContext(arg.message);
      },
      "sdk"
    );

    this.eventBus.subscribe(
      "SDK_ERROR",
      arg => {
        if (arg.message.startsWith("Blocked:")) {
          if (!this._bridge.noBlockerEvent) {
            this.msgrt.send(`error`, { message: arg.message });
            if (!this._hasBlocker) {
              this._hasBlocker = true;
              this._sendTunnlEvent(3);
            }
          }
        } else {
          this.msgrt.send(`error`, { message: arg.message });
        }
      },
      "sdk"
    );

    this.eventBus.subscribe(
      "AD_REQUEST",
      arg => {
        // this.msgrt.send(`req.ad.${arg.message}`);
      },
      "sdk"
    );

    this.eventBus.subscribe(
      "AD_REQUEST_KEYS_EMPTY",
      arg => {
        this.msgrt.send(`tunnl.keys.empty`, {
          message: arg.message,
          details: arg.details
        });
      },
      "sdk"
    );

    this.eventBus.subscribe(
      "AD_REQUEST_KEYS_FALLBACK",
      arg => {
        this.msgrt.send(`tunnl.keys.fallback`, {
          message: arg.message,
          details: arg.details
        });
      },
      "sdk"
    );
  }

  /**
   * _gdpr
   * GDPR (General Data Protection Regulation).
   * Broadcast GDPR events to our game developer.
   * They can hook into these events to kill their own solutions/ services.
   */
  _gdpr() {
    const tracking = document.location.search.indexOf("gdpr-tracking") >= 0;
    const trackingConsent =
      document.location.search.indexOf("gdpr-tracking=1") >= 0;
    const targeting = document.location.search.indexOf("gdpr-targeting") >= 0;
    const targetingConsent =
      document.location.search.indexOf("gdpr-targeting=1") >= 0;
    const third = document.location.search.indexOf("gdpr-third-party") >= 0;
    const thirdConsent =
      document.location.search.indexOf("gdpr-third-party=1") >= 0;
    const GeneralDataProtectionRegulation = [
      {
        name: "SDK_GDPR_TRACKING",
        message: tracking
          ? trackingConsent
            ? "Allowed"
            : "Not allowed"
          : "Not set",
        status: trackingConsent ? "success" : "warning",
        label: tracking ? (trackingConsent ? "1" : "0") : "not set"
      },
      {
        name: "SDK_GDPR_TARGETING",
        message: targeting
          ? targetingConsent
            ? "Allowed"
            : "Not allowed"
          : "Not set",
        status: targetingConsent ? "success" : "warning",
        label: targeting ? (targetingConsent ? "1" : "0") : "not set"
      },
      {
        name: "SDK_GDPR_THIRD_PARTY",
        message: third ? (thirdConsent ? "Allowed" : "Not allowed") : "Not set",
        status: thirdConsent ? "success" : "warning",
        label: third ? (thirdConsent ? "1" : "0") : "not set"
      }
    ];
    GeneralDataProtectionRegulation.forEach(obj => {
      this.eventBus.broadcast(obj.name, {
        name: obj.name,
        message: obj.message,
        status: obj.status,
        analytics: {
          category: obj.name,
          action: this._parentDomain,
          label: obj.label
        }
      });
    });
  }

  _checkGameId() {
    if (this.options.gameId === this._defaults.gameId) {
      this._sendSDKError(
        "Check correctness of your GAME ID. Otherwise, no revenue will be recorded."
      );
    }
  }

  _getDefaultGameData() {
    return {
      gameId: this.options.gameId,
      enableAds: true,
      preroll: true,
      midroll: 2 * 60000,
      rewardedAds: false,
      title: "",
      tags: [],
      category: "",
      assets: [],
      sdk: this._getDefaultAdSDKData(),
      loader: this._getDefaultLoaderData(),
      splash: this._getDefaultSplashData(),
      promo: this._getDefaultPromoData(),
      dAds: this._getDefaultDisplayAdsData(),
      pAds: this._getDefaultPrerollAdsData(),
      mAds: this._getDefaultMidrollAdsData(),
      rAds: this._getDefaultRewardedAdsData(),
    };
  }

  _getDefaultAdSDKData() { return {} }

  _getDefaultLoaderData() { return {} }

  _getDefaultSplashData() { return {} }

  _getDefaultPromoData() { return {} }

  _getDefaultDisplayAdsData() { return { enabled: true } }

  _getDefaultPrerollAdsData() { return {} }

  _getDefaultMidrollAdsData() { return {} }

  _getDefaultRewardedAdsData() { return {} }

  _getGameDataUrl() {
    // const gameDataUrl = `https://game.api.gamedistribution.com/game/get/${id.replace(
    //     /-/g,
    //     ''
    // )}/?domain=${domain}&localTime=${new Date().getHours()}&v=${PackageJSON.version}`;
    const gameDataUrl = `https://game.api.gamedistribution.com/game/v3/get/${this.options.gameId.replace(
      /-/g,
      ""
    )}/?domain=${this._parentDomain}&v=${
      PackageJSON.version
      }&localTime=${new Date().getHours()}`;

    return gameDataUrl;
  }

  _checkBlocking() {
    const gameData = this._gameData;

    if (gameData.bloc_gard && gameData.bloc_gard.enabled === true) {
      this.msgrt.send("blocked");
      setTimeout(() => {
        document.location = `https://html5.api.gamedistribution.com/blocked.html?domain=${this._parentDomain}`;
      }, 1000);
    } else {
      // Lotame tracking.
      // It is critical to wait for the load event. Yes hilarious.
      window.addEventListener("load", () => {
        // try {
        //   gameData.tags.forEach(tag => {
        //     window["_cc13998"].bcpw("int", `tags : ${tag.title.toLowerCase()}`);
        //   });

        //   window["_cc13998"].bcpw(
        //     "int",
        //     `category : ${gameData.category.toLowerCase()}`
        //   );
        // } catch (error) {
        //   // No need to throw an error or log. It's just Lotame.
        // }
      });
    }
  }

  _changeMidrollInDebugMode() {
    const gameData = this._gameData;

    if (!Ls.available) return;

    // Enable some debugging perks.
    if (Ls.getBoolean("gd_debug_ex")) {
      if (Ls.getBoolean("gd_disable_midroll_timer")) gameData.midroll = 0;
      else gameData.midroll = this._getDefaultGameData().midroll;
    }
  }

  _checkSplashAndPromoScreens() {
    const gameData = this._gameData;

    // If the preroll is disabled, we just set the adRequestTimer.
    // That way the first call for an advertisement is cancelled.
    // Else if the pre-roll is true and auto-play is true, then we
    // create a splash screen so we can force a user action before
    // starting a video advertisement.
    //
    // SpilGames demands a GDPR consent wall to be displayed.
    const isConsentDomain = gameData.gdpr && gameData.gdpr.consent === true;
    const loader = gameData.loader;
    const promo = gameData.promo;

    if (this.options.loader.enabled) {
      if (promo.enabled) this._createPromoBeforeSplash(gameData, isConsentDomain);
      else {
        if (loader.enabled) this._createSplash(gameData, isConsentDomain);
        else this.onResumeGame("Advertisement(s) are done. Start / resume the game.", "success");
      }
    } else if (!loader.enabled && (!this._bridge.isTokenGameURL || !this._bridge.isExtHostedGameURL)) {
      if (!gameData.preroll) {
        this.adRequestTimer = Date.now();
      }
      else if (this.options.advertisementSettings.autoplay || isConsentDomain) {
        if (promo.enabled) this._createPromoBeforeSplash(gameData, isConsentDomain);
        else if (loader.enabled !== false) this._createSplash(gameData, isConsentDomain);
      }
      else {
        if (promo.enabled) this._createPromo(gameData, isConsentDomain);
      }
    }
  }

  async _initializeVideoAd() {
    const gameData = this._gameData;

    if (gameData.sdk.enabled)
      this.options.advertisementSettings = extendDefaults(
        this.options.advertisementSettings,
        gameData.sdk
      );

    this.macros = new Macros({
      game: gameData,
      bridge: this._bridge
    });

    // Create a new VideoAd instance (singleton).
    this.adInstance = new VideoAd(
      // Deprecated parameters.
      this.options.flashSettings.adContainerId,
      this.options.advertisementSettings,
      { parentURL: this._parentURL, parentDomain: this._parentDomain }
    );

    // Set some targeting/ reporting values.
    this.adInstance.gameId = gameData.gameId;
    this.adInstance.category = gameData.category;
    this.adInstance.tags = gameData.tags;
    this.adInstance.noPreroll = this._bridge.noPreroll;
    this.adInstance.macros = this.macros;

    // Wait for the adInstance to be ready.
    await this.adInstance.start();
  }

  _sendSDKReady() {
    // Send out event for modern implementations.
    let eventName = "SDK_READY";
    let eventMessage = "Everything is ready.";
    this.eventBus.broadcast(eventName, {
      message: eventMessage,
      status: "success"
    });

    // Call legacy backwards compatibility method.
    try {
      this.options.onInit(eventMessage);
    } catch (error) {
      dankLog("DEVELOPER_ERROR", error.message, "warning");
      // if (this.msgrt) {
      //   this.msgrt.send("dev.error", {
      //     message: error.message,
      //     details: "onInit"
      //   });
      // }
    }
  }

  _sendSDKError(error) {
    error = error.message ? error : { message: error };

    // Send out event for modern implementations.
    let eventName = "SDK_ERROR";
    this.eventBus.broadcast(eventName, {
      message: error.message,
      status: "error"
    });

    try {
      this.options.onError(error);
    } catch (error) {
      dankLog("DEVELOPER_ERROR", error.message, "warning");
      // if (this.msgrt) {
      //   this.msgrt.send("dev.error", {
      //     message: error.message,
      //     details: "onError"
      //   });
      // }
    }
  }

  /**
   * _onEvent
   * Gives us a nice console log message for all our events going
   * through the EventBus.
   * @param {Object} event
   * @private
   */
  _onEvent(event) {
    // Show the event in the log.
    dankLog(event.name, event.message, event.status);
    // Push out a Google event for each event. Makes our life easier. I think.
    // try {
    /* eslint-disable */
    // if (typeof window['ga'] !== 'undefined' && event.analytics) {
    //     window['ga']('gd.send', {
    //         hitType: 'event',
    //         eventCategory: (event.analytics.category)
    //             ? event.analytics.category
    //             : '',
    //         eventAction: (event.analytics.action)
    //             ? event.analytics.action
    //             : '',
    //         eventLabel: (event.analytics.label)
    //             ? event.analytics.label
    //             : '',
    //     });
    // }
    /* eslint-enable */
    // } catch (error) {
    //   throw new Error(error);
    // }

    // Now send the event data to the developer.
    try {
      this.options.onEvent({
        name: event.name,
        message: event.message,
        status: event.status
      });
    } catch (error) {
      dankLog("DEVELOPER_ERROR", error.message, "warning");
      // if (this.msgrt) {
      //   this.msgrt.send("dev.error", {
      //     message: error.message,
      //     details: "onEvent"
      //   });
      // }
    }
  }

  /**
   * getGameData
   * @return {Promise<any>}
   * @private
   */
  _getGameData() {
    return new Promise(resolve => {
      let defaultGameData = this._getDefaultGameData();
      const gameDataUrl = this._getGameDataUrl();

      fetch(gameDataUrl)
        .then(response => {
          return response.json();
        })
        .then(json => {
          if (json.success) {
            const rawGame = json.result.game;
            const retrievedGameData = {
              gameId: rawGame.gameMd5,
              description: rawGame.description,
              enableAds: rawGame.enableAds,
              preroll: rawGame.preRoll,
              midroll: rawGame.timeAds * 60000,
              rewardedAds: rawGame.rewardedAds,
              title: rawGame.title,
              tags: rawGame.tags,
              category: rawGame.category,
              assets: rawGame.assets,
              disp_2nd_prer: rawGame.disp_2nd_prer,
              ctry_vst: rawGame.ctry_vst,
              ctry: rawGame.ctry,
              block_exts: this._parseAndSelectRandomOne(rawGame.push_cuda),
              bloc_gard: this._parseAndSelectRandomOne(rawGame.bloc_gard),
              cookie: this._parseAndSelectRandomOne(rawGame.cookie),
              gdpr: this._parseAndSelectRandomOne(rawGame.gdpr),
              diagnostic: this._parseAndSelectRandomOne(rawGame.diagnostic),
              sdk: this._parseAndSelectRandomOne(rawGame.sdk) || this._getDefaultAdSDKData(),
              loader: this._parseAndSelectRandomOne(rawGame.loader) || this._getDefaultLoaderData(),
              splash: this._parseAndSelectRandomOne(rawGame.splash) || this._getDefaultSplashData(),
              promo: this._parseAndSelectRandomOne(rawGame.promo) || this._getDefaultPromoData(),
              dAds: this._parseAndSelectRandomOne(rawGame.dads) || this._getDefaultDisplayAdsData(),
              pAds: this._parseAndSelectRandomOne(rawGame.pads) || this._getDefaultPrerollAdsData(),
              mAds: this._parseAndSelectRandomOne(rawGame.mads) || this._getDefaultMidrollAdsData(),
              rAds: this._parseAndSelectRandomOne(rawGame.rads) || this._getDefaultRewardedAdsData(),
            };

            let gameData = extendDefaults(
              cloneDeep(defaultGameData),
              retrievedGameData
            );

            if (this._bridge.noPreroll) {
              this.adRequestTimer = Date.now();
            }

            this.msgrt.setGameData(gameData);

            setDankLog(gameData.diagnostic);

            resolve(gameData);
          } else {
            defaultGameData.failed = true;
            resolve(defaultGameData);
          }
        })
        .catch(error => {
          defaultGameData.failed = true;
          resolve(defaultGameData);
        });
    });
  }

  /**
   * _createSplash
   * Create splash screen for developers who can't add the advertisement
   * request behind a user action.
   * @param {Object} gameData
   * @param {Boolean} isConsentDomain - Determines if the publishers requires a GDPR consent wall.
   * @private
   */
  _createSplash(gameData, isConsentDomain) {
    const ActiveSplash = this._getSplashTemplate(gameData);
    let splash = new ActiveSplash(
      { ...this.options, isConsentDomain, version: PackageJSON.version },
      gameData
    );
    splash.on("playClick", () => {
      if (isConsentDomain) {
        // Set consent cookie.
        const date = new Date();
        date.setDate(date.getDate() + 90); // 90 days, similar to Google Analytics.
        document.cookie = `ogdpr_tracking=1; expires=${date.toUTCString()}; path=/`;
      }
      // Now show the advertisement and continue to the game.
      this.showAd(AdType.Interstitial).catch(reason => { });
    });

    splash.on("slotVisibilityChanged", (slot) => {
      if (slot.visible) {
        this.showDisplayAd({ containerId: slot.id, visible: slot.visible });
      }
    });

    // Now pause the game.
    this.onPauseGame("Pause the game and wait for a user gesture", "success");

    // Make sure the container is removed when an ad starts.
    this.eventBus.subscribe("SDK_GAME_PAUSE", () => {
      splash.hide();
    });

    // Make sure the container is removed when the game is resumed.
    this.eventBus.subscribe("SDK_GAME_START", () => {
      splash.hide();
    });
  }

  /**
   * _createPromoBeforeSplash
   * @param {Object} gameData
   * @param {Boolean} isConsentDomain - Determines if the publishers requires a GDPR consent wall.
   * @private
   */
  _createPromoBeforeSplash(gameData, isConsentDomain) {
    const ActivePromo = this._getPromoTemplate(gameData);
    let promo = new ActivePromo(
      { ...this.options, isConsentDomain, version: PackageJSON.version },
      gameData
    );
    promo.on("skipClick", () => {
      promo.hide();
      this._createSplash(gameData, isConsentDomain);
    });
  }

  /**
   * _createPromo
   * @param {Object} gameData
   * @param {Boolean} isConsentDomain - Determines if the publishers requires a GDPR consent wall.
   * @private
   */
  _createPromo(gameData, isConsentDomain) {
    const ActivePromo = this._getPromoTemplate(gameData);
    let promo = new ActivePromo(
      { ...this.options, isConsentDomain, version: PackageJSON.version },
      gameData
    );
    promo.on("skipClick", () => {
      promo.hide();
      this.onResumeGame("Resumed after the promo", "warning");
    });
    this.onPauseGame("Pause the game for the promo", "success");
  }
  /**
   * [DEPRECATED]
   * showBanner
   * Used by our developer to call a video advertisement.
   * @public
   */
  showBanner() {

    this.showAd(AdType.Interstitial).catch(reason => { });
  }
  /**
   * showAd
   * Used as inner function to call a type of video advertisement.
   * @param {String} adType
   * @param {Object} retryOptions
   * @return {Promise<any>}
   * @private
   */
  async showAd(adType, retryOptions) {
    return new Promise(async (resolve, reject) => {
      try {
        const gameData = await this.sdkReady;

        // Check blocked game
        if (gameData.bloc_gard && gameData.bloc_gard.enabled === true) {
          throw new Error("Game or domain is blocked.");
        }

        // Reject in case we don't want to serve ads.
        if (!gameData.enableAds || this._whitelabelPartner) {
          throw new Error("Advertisements are disabled.");
        }

        // Check ad type
        if (!adType) {
          adType = AdType.Interstitial;
        } else if (
          adType !== AdType.Interstitial &&
          adType !== AdType.Rewarded
        ) {
          throw new Error("Unsupported an advertisement type: ", adType);
        }

        // check if the rewarded ads is enabled for the game.
        if (adType === AdType.Rewarded && !gameData.rewardedAds) {
          throw new Error("Rewarded ads are disabled.");
        }

        // Check if the interstitial advertisement is not called too often.
        if (adType === AdType.Interstitial && typeof this.adRequestTimer !== "undefined") {
          const elapsed = Date.now() - this.adRequestTimer;
          if (elapsed < gameData.midroll) {
            throw new Error("The advertisement was requested too soon.");
          }
        }

        // The scope should be cleaned up. It requires better solution.
        let scopeName = "main.showad";

        let retry = (options) => {
          this.adInstance.resetForNext();
          this.showAd(adType, options)
            .then(response => {
              this.adRequestTimer = Date.now();
              this.onResumeGame("Advertisement(s) are done. Start / resume the game.", "success");
              resolve("");
            })
            .catch(error => {
              if (options.retry_on_success) {
                this.adRequestTimer = Date.now();
                this.onResumeGame("Advertisement(s) are done. Start / resume the game.", "success");
                resolve("");
              }
              else if (options.retry_on_failure) {
                // Puzzle promo
                let puzzle = (gameData.promo || {}).puzzle || {};

                if (puzzle.enabled && (
                  (puzzle.trigger.interstitial_failure && adType === AdType.Interstitial) ||
                  (puzzle.trigger.rewarded_failure && adType === AdType.Rewarded)
                )) {
                  this._showPromoDisplayAd().then(response => {
                    this.onResumeGame('DisplayAd succeded.', "success");
                    resolve('DisplayAd succeded.');
                  }).catch(reason => {
                    this.onResumeGame('DisplayAd failed.', "warning");
                    reject('DisplayAd failed.');
                  });
                } else {
                  this.onResumeGame(error.message || error, "warning");
                  reject(error.message || error);
                }
              }
              else {
                this.onResumeGame(error.message || error, "warning");
                reject(error.message || error);
              }
            });
        };

        let onFailure = (args) => {
          this.eventBus.unsubscribeScope(scopeName);

          if (typeof retryOptions !== "undefined") {
            reject(args.message);
          } else {
            let retry_on_failure = this._isRetryOnFailureEnabled(adType);

            if (retry_on_failure) retry({ retry_on_failure: true });
            else {

              // Puzzle promo
              let puzzle = (gameData.promo || {}).puzzle || {};

              if (puzzle.enabled && (
                (puzzle.trigger.interstitial_failure && adType === AdType.Interstitial) ||
                (puzzle.trigger.rewarded_failure && adType === AdType.Rewarded)
              )) {
                this._showPromoDisplayAd().then(response => {
                  this.onResumeGame('DisplayAd succeded.', "success");
                  resolve('DisplayAd succeded.');
                }).catch(reason => {
                  this.onResumeGame('DisplayAd failed.', "warning");
                  reject('DisplayAd failed.');
                });
              } else {
                this.onResumeGame(args.message, "warning");
                reject(args.message);
              }
            }
          }
        };

        let onSuccess = (args) => {
          this.eventBus.unsubscribeScope(scopeName);
          // this.eventBus.printScope(scopeName);

          if (typeof retryOptions !== "undefined") {
            resolve(args.message);
          } else {
            let retry_on_success = this._isRetryOnSuccessEnabled(adType);

            if (retry_on_success) retry({ retry_on_success: true });
            else {
              // default
              this.adRequestTimer = Date.now();
              this.onResumeGame("Advertisement(s) are done. Start / resume the game.", "success");
              resolve(args.message);
            }
          }
        };

        // ERROR
        this.eventBus.subscribe("AD_ERROR", onFailure, scopeName);
        this.eventBus.subscribe("AD_SDK_CANCELED", onFailure, scopeName);

        // SUCCESS
        this.eventBus.subscribe("AD_SUCCESS", onSuccess, scopeName);

        // Start the advertisement.
        await this.adInstance.startAd(adType, retryOptions);
      } catch (error) {
        this.onResumeGame(error.message, "warning");
        reject(error.message);
      }
    });
  }

  _isRetryOnSuccessEnabled(adType) {
    const gameData = this._gameData;
    const adPosition = this.adInstance.getAdPosition(adType);

    let result = gameData.sdk.enabled && (gameData.sdk.retry_on_success === true || isPlainObject(gameData.sdk.retry_on_success));

    if (adPosition === 'preroll' && typeof gameData.pAds.retry_on_success !== 'undefined')
      result = result && gameData.pAds.retry_on_success;
    else if (adPosition === 'midroll' && typeof gameData.mAds.retry_on_success !== 'undefined')
      result = result && gameData.mAds.retry_on_success;
    else if (adPosition === 'rewarded' && typeof gameData.rAds.retry_on_success !== 'undefined')
      result = result && gameData.rAds.retry_on_success;

    return result;
  }

  _isRetryOnFailureEnabled(adType) {
    const gameData = this._gameData;
    const adPosition = this.adInstance.getAdPosition(adType);

    let result = gameData.sdk.enabled && (gameData.sdk.retry_on_failure === true || isPlainObject(gameData.sdk.retry_on_failure));

    if (adPosition === 'preroll' && typeof gameData.pAds.retry_on_failure !== 'undefined')
      result = result && gameData.pAds.retry_on_failure;
    else if (adPosition === 'midroll' && typeof gameData.mAds.retry_on_failure !== 'undefined')
      result = result && gameData.mAds.retry_on_failure;
    else if (adPosition === 'rewarded' && typeof gameData.rAds.retry_on_failure !== 'undefined')
      result = result && gameData.rAds.retry_on_failure;

    return result;
  }

  /**
   * preloadRewarded
   * Preload a rewarded ad. By default we preload interstitials.
   * The developer can use this method to check for rewarded ads availability.
   * We have to do this due to low fill rate of rewarded ads.
   * This way the developer can decide whether to show a rewarded ads button within their game.
   * @param {String} adType
   * @return {Promise<any>}
   * @public
   */
  async preloadAd(adType) {
    return new Promise(async (resolve, reject) => {
      try {
        const gameData = await this.sdkReady;

        // Check blocked game
        if (gameData.bloc_gard && gameData.bloc_gard.enabled === true) {
          throw new Error("Game or domain is blocked.");
        }

        // Check ad type
        if (!adType) {
          adType = AdType.Rewarded;
        } else if (
          adType !== AdType.Interstitial &&
          adType !== AdType.Rewarded
        ) {
          throw new Error("Unsupported an advertisement type:" + adType);
        }

        // check if the rewarded ads is enabled for the game.
        if (adType === AdType.Rewarded && !gameData.rewardedAds) {
          throw new Error("Rewarded ads are disabled.");
        }
        const result = await this.adInstance.preloadAd(adType);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * cancelAd
   * Cancels the current loaded/ running advertisement.
   * @return {Promise<void>}
   */
  async cancelAd() {
    return new Promise(async (reject, resolve) => {
      try {
        this.adInstance.cancel();
        resolve();
      } catch (error) {
        reject(error.message);
      }
    });
  }

  /**
   * showDisplayAd
   * Used by our developer to call a display/banner advertisement.
   * @param {Object} options
   * @return {Promise<any>}
   * @public
   */
  showDisplayAd(options) {
    return new Promise(async (resolve, reject) => {
      try {
        const gameData = await this.sdkReady;
        if (gameData.dAds.enabled) {
          await this.adInstance.loadDisplayAd(options);
          resolve();
        } else {
          reject('Display-Ads are disabled.');
        }
      } catch (error) {
        reject(error.message || error);
      }
    });
  }

  /**
   * onResumeGame
   * Called from various moments within the SDK. This sends
   * out a callback to our developer, so he/ she can allow the game to
   * resume again. We also call resumeGame() for backwards
   * compatibility reasons.
   * @param {String} message
   * @param {String} status
   */
  onResumeGame(message, status) {
    this._allowExternals({ enabled: false });

    try {
      this.options.resumeGame();
    } catch (error) {
      dankLog("DEVELOPER_ERROR", error.message, "warning");
      // if (this.msgrt) {
      //   this.msgrt.send("dev.error", {
      //     message: error.message,
      //     details: "resumeGame"
      //   });
      // }
    }

    let eventName = "SDK_GAME_START";
    this.eventBus.broadcast(eventName, {
      name: eventName,
      message: message,
      status: status,
      analytics: {
        category: "SDK",
        action: eventName,
        label: this.options.gameId + ""
      }
    });
  }

  /**
   * onPauseGame
   * Called from various moments within the SDK. This sends
   * out a callback to pause the game. It is required to have the game
   * paused when an advertisement starts playing.
   * @param {String} message
   * @param {String} status
   */
  onPauseGame(message, status) {
    this._allowExternals({ enabled: true });

    try {
      this.options.pauseGame();
    } catch (error) {
      dankLog("DEVELOPER_ERROR", error.message, "warning");
      // if (this.msgrt) {
      //   this.msgrt.send("dev.error", {
      //     message: error.message,
      //     details: "pauseGame"
      //   });
      // }
    }
    let eventName = "SDK_GAME_PAUSE";
    this.eventBus.broadcast(eventName, {
      name: eventName,
      message: message,
      status: status,
      analytics: {
        category: "SDK",
        action: eventName,
        label: this.options.gameId + ""
      }
    });
  }

  /**
   * openConsole
   * Enable debugging, we also set a value in localStorage,
   * so we can also enable debugging without setting the property.
   * This is nice for when we're trying to debug a game that is not ours.
   * @public
   */
  openConsole() {
    try {
      const implementation = new ImplementationTest(this);
      implementation.start();
      Ls.set("gd_debug_ex", true);
    } catch (error) {
      console.log(error);
    }
  }

  /**
   * _initExternals
   * @private
   */
  _initBlockingExternals() {
    const gameData = this._gameData;
    const block =
      gameData.failed || (gameData.block_exts && gameData.block_exts.enabled);
    if (!block) return;

    this.window_open = window.open;
    this._allowExternals({ enabled: false });
    this._removeExternalsInHtml({ enabled: false });
  }

  /**
   * _allowExternals
   * @private
   * @param {Object} options
   */
  _allowExternals(options) {
    if (typeof this.window_open === "undefined") return;

    if (options.enabled === false) {
      window.open = url => {
        this.msgrt.send("external", { message: `C> ${url}` });
        if (url.startsWith('https://play.google.com') || url.startsWith('https://itunes.apple.com')) {
          this.window_open.call(null, url);
        }
      };
    } else {
      window.open = this.window_open;
    }
  }
  /**
   * _removeExternalsInHtml
   * @private
   * @param {Object} options   *
   */
  _removeExternalsInHtml(options) {
    if (options.enabled === false) {
      let links = window.document.querySelectorAll("a");
      links.forEach(el => {
        let url = el.getAttribute("href");
        el.setAttribute("href", "#");
        el.onclick = evt => {
          evt.preventDefault();
          this.msgrt.send("external", { message: `H> ${url}` });
          return false;
        };
      });
    }
  }

  _getBridgeContext() {
    let isTokenGameURL = this._isTokenGameURL();
    let isMasterGameURL = this._isMasterGameURL();
    let isExtHostedGameURL = this._isExtHostedGameURL();

    let config =
      isTokenGameURL || isExtHostedGameURL ? this._getTokenGameURLConfig() : {};
    config = config || {};

    const parentURL =
      (isTokenGameURL || isExtHostedGameURL) && config.parentURL
        ? config.parentURL
        : getParentUrl();

    const parentDomain =
      (isTokenGameURL || isExtHostedGameURL) && config.parentDomain
        ? config.parentDomain
        : getParentDomain();

    const topDomain =
      (isTokenGameURL || isExtHostedGameURL) && config.topDomain
        ? config.topDomain
        : getTopDomain();

    let noConsoleBanner =
      (isTokenGameURL || isExtHostedGameURL) && config.loaderEnabled;
    let noLoadedEvent =
      (isTokenGameURL || isExtHostedGameURL) && config.loaderEnabled;
    let noBlockerEvent =
      (isTokenGameURL || isExtHostedGameURL) && config.loaderEnabled;
    let noGAPageView =
      (isTokenGameURL || isExtHostedGameURL) && config.loaderEnabled;
    let noLotamePageView =
      (isTokenGameURL || isExtHostedGameURL) && config.loaderEnabled;

    // let noPreroll =
    //   (isTokenGameURL || isExtHostedGameURL) &&
    //   config.loaderEnabled &&
    //   config.hasImpression;

    let noPreroll =
      (isTokenGameURL || isExtHostedGameURL) &&
      config.loaderEnabled;

    let pauseGameOnStartup =
      (isTokenGameURL || isExtHostedGameURL) &&
      config.loaderEnabled &&
      config.hasImpression &&
      config.version >= "1.1.24";
    if (pauseGameOnStartup) {
      this._connectToMessageFromGameZone();
    }
    return {
      isTokenGameURL,
      isMasterGameURL,
      isExtHostedGameURL,
      noConsoleBanner,
      noLoadedEvent,
      noBlockerEvent,
      noPreroll,
      parentURL,
      parentDomain,
      topDomain,
      noGAPageView,
      noLotamePageView,
      version: config.version,
      pauseGameOnStartup,
      depth: getIframeDepth(),
      domainMatched: parentDomain === topDomain,
      exports: {
        formatTokenURLSearch: this._formatTokenURLSearch.bind(this)
      }
    };
  }

  _isMasterGameURL() {
    var regex = /http[s]?:\/\/(html5\.gamedistribution\.com\/[A-Fa-f0-9]{32})(.*)$/i;
    return (
      regex.test(location.href) ||
      (!this._isTokenGameURL() && regex.test(document.referrer))
    );
  }

  _isTokenGameURL() {
    var regex = /http[s]?:\/\/(html5\.gamedistribution\.com\/[A-Za-z0-9]{8})\/(.*)$/i;
    return regex.test(location.href) || regex.test(document.referrer);
  }

  _isExtHostedGameURL() {
    var regex = /^http[s]?:\/\/.*?gd_sdk_referrer_url=.*$/i;
    return regex.test(location.href) || regex.test(document.referrer);
  }

  _getTokenGameURLConfig() {
    try {
      var regex = /http[s]?:\/\/html5\.gamedistribution\.com\/[A-Za-z0-9]{8}\/[A-Fa-f0-9]{32}\/.*/i;
      let encoded;
      if (regex.test(location.href)) {
        let parser = new Url(location.href, true);
        if (parser.query.gd_zone_config) encoded = parser.query.gd_zone_config;
        else return;
      } else if (regex.test(document.referrer)) {
        let parser = new Url(document.referrer, true);
        if (parser.query.gd_zone_config) encoded = parser.query.gd_zone_config;
        else return;
      } else {
        let parser = new Url(location.href, true);
        if (parser.query.gd_zone_config) encoded = parser.query.gd_zone_config;
        else return;
      }

      return JSON.parse(Base64.decode(decodeURIComponent(encoded)));
    } catch (error) { }
  }

  _getSplashTemplate(gameData) {
    let splash = gameData.splash;
    if (splash.template === "quantum") return Quantum;
    else if (splash.template === "pluto") return Pluto;
    else return Mars;

  }

  _getPromoTemplate(gameData) {
    return Hammer;
  }

  _formatTokenURLSearch(data) {
    let encoded = "";
    try {
      encoded = encodeURIComponent(Base64.encode(JSON.stringify(data)));
    } catch (error) { }
    try {
      let parser = new Url(location.href, true);
      parser.query = parser.query || {};
      parser.query["gd_zone_config"] = encoded;
      return `?${qs.stringify(parser.query)}`;
    } catch (error) {
      return `?gd_zone_config=${encoded}`;
    }
  }

  _connectToMessageFromGameZone() {
    if (window.addEventListener)
      window.addEventListener(
        "message",
        this._onMessageFromGameZone.bind(this),
        false
      );
    else
      window.attachEvent("onmessage", this._onMessageFromGameZone.bind(this));
  }

  _onMessageFromGameZone(event) {
    if (!event.data || !event.data.topic) return;

    let topic = event.data.topic;
    if (topic === "gdzone.resume") {
      // this.msgrt.send("gamezone.resume");
    }
  }

  _parseAndSelectRandomOne(json) {
    let item = this._selectRandomOne(parseJSON(json));
    if (!item || !item.version) return item;

    if (PackageJSON.version >= item.version) return item;
  }

  _selectRandomOne(items) {
    if (!isArray(items) || items.length === 0) return items;
    if (items.length === 1) return items[0];

    let totalWeight = 0;
    items.forEach(item => {
      item.weight = item.weight || 1;
      totalWeight += item.weight;
    });
    let randomWeight = Math.floor(Math.random() * Math.floor(totalWeight));
    totalWeight = 0;
    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      totalWeight += item.weight;
      if (randomWeight < totalWeight) {
        return item;
      }
    }
  }

  session() {
    return new Promise(async (resolve, reject) => {

      try {
        await this.sdkReady;
      } catch (error) { }
      const gameData = this._gameData;

      resolve({
        ads: {
          display: {
            enabled: gameData.dAds.enabled
          }
        },
        location: {
          parentDomain: this._bridge.parentDomain,
          topDomain: this._bridge.topDomain,
          parentURL: this._bridge.parentURL,
          depth: this._bridge.depth,
          loadedByGameZone: this._bridge.isTokenGameURL
        }
      });
    });
  }

  _showPromoDisplayAd() {
    return new Promise((resolve, reject) => {
      const gameData = this._gameData;

      const ActivePromo = Puzzle;
      let promo = new ActivePromo(
        { ...this.options, version: PackageJSON.version },
        gameData
      );

      let scopeName = 'promo-display';

      this.eventBus.unsubscribeScope(scopeName);

      const onImpression = () => {
        this.eventBus.unsubscribeScope(scopeName);
        promo.show();
      }

      const onFailure = () => {
        this.eventBus.unsubscribeScope(scopeName);
        promo.hide();
        reject('No promo display ad');
      }

      this.eventBus.subscribe("DISPLAYAD_IMPRESSION", onImpression, scopeName);
      this.eventBus.subscribe("DISPLAYAD_ERROR", onFailure, scopeName);

      this.showDisplayAd({ containerId: promo.getSlotContainerId(), slotId: promo.getSlotId(), visible: true })
        .catch(error => {
          promo.hide();
          reject(error);
        });

      promo.on("skipClick", () => {
        promo.hide();
        resolve();
      });

      promo.on("adCompleted", () => {
        promo.hide();
        resolve();
      });
    });
  }
}

export default SDK;