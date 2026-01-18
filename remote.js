/* global MMSocket showdown */

// main javascript file for the remote control page

const Remote = {
  name: "MMM-TMM-Control",
  currentMenu: "main-menu",
  types: ["string", "number", "boolean", "array", "object", "null", "undefined"],
  values: ["", 0.0, true, [], {}, null, undefined],
  validPositions: [
    "",
    "top_bar",
    "top_left",
    "top_center",
    "top_right",
    "upper_third",
    "middle_center",
    "lower_third",
    "bottom_left",
    "bottom_center",
    "bottom_right",
    "bottom_bar",
    "fullscreen_above",
    "fullscreen_below"
  ],
  savedData: {},
  translations: {},
  currentConfig: {},
  addModule: "",
  changedModules: [],
  deletedModules: [],
  autoHideTimer: undefined, // Internal: Reference to the active auto-hide timeout (do not modify manually)
  autoHideDelay: 2000, // ms - Time after which success messages are auto hidden
  autoHideDelayError: 30 * 1000, // ms - Time for error messages (0 = no auto-hide, must be clicked away)
  autoHideDelayInfo: 30 * 1000, // ms - Time for info messages like PM2 restart/stop

  /*
   * socket()
   * Returns a socket object. If it doesn't exist, it's created.
   * It also registers the notification callback.
   */
  socket () {
    if (typeof this._socket === "undefined") {
      this._socket = this._socket = new MMSocket(this.name);
    }

    const self = this;
    this._socket.setNotificationCallback((notification, payload) => {
      self.socketNotificationReceived(notification, payload);
    });

    return this._socket;
  },

  /*
   * sendSocketNotification(notification, payload)
   * Send a socket notification to the node helper.
   *
   * argument notification string - The identifier of the notification.
   * argument payload mixed - The payload of the notification.
   */
  sendSocketNotification (notification, payload) {
    this.socket().sendNotification(notification, payload);
  },

  /*
   * socketNotificationReceived(notification, payload)
   * This method is called when a socket notification arrives.
   *
   * argument notification string - The identifier of the notification.
   * argument payload mixed - The payload of the notification.
   */
  socketNotificationReceived (notification, payload) {

    // 接收来自 updatenotification 模块的更新状态
    if (notification === "TCLIENT_UPDATE_AVAILABLE") {
      this.mmUpdateCallback(payload);
      return;
    }

    if (notification === "REMOTE_ACTION_RESULT") {
      if ("action" in payload && payload.action === "INSTALL") {
        this.installCallback(payload);
        return;
      }
      // 处理 mmUpdateAvailable (有 result 字段但没有 data 字段)
      if ("result" in payload && payload.query && payload.query.data === "mmUpdateAvailable") {
        this.mmUpdateCallback(payload.result);
        return;
      }
      if ("data" in payload) {
        if (payload.query.data === "config_update") {
          this.saveConfigCallback(payload);
        } else if (payload.query.data === "saves") {
          this.undoConfigMenuCallback(payload);
        } else if (payload.query.data === "brightness") {
          const slider = document.getElementById("brightness-slider");
          slider.value = payload.result;
        } else if (payload.query.data === "translations") {
          this.translations = payload.data;
          this.onTranslationsLoaded();
        } else {
          this.loadListCallback(payload);
        }
        return;
      }
      if ("code" in payload && payload.code === "restart") {
        const chlog = new showdown.Converter();
        chlog.setFlavor("github");
        this.offerRestart(payload.chlog
          ? `${payload.info}<br><div id='changelog'>${chlog.makeHtml(payload.chlog)}</div>`
          : payload.info);
        return;
      }
      // 处理显示器控制响应
      if ("monitor" in payload) {
        const monitorToggleBtn = document.getElementById("monitor-toggle-button");
        const monitorBtnText = monitorToggleBtn.querySelector(".text");
        const monitorBtnIcon = monitorToggleBtn.querySelector(".fa");

        if (payload.monitor === "on") {
          // 显示器已打开，按钮显示"关闭显示器"
          monitorBtnText.textContent = this.translate("MONITOROFF");
          monitorBtnIcon.className = "fa fa-fw fa-television";
        } else if (payload.monitor === "off") {
          // 显示器已关闭，按钮显示"打开显示器"
          monitorBtnText.textContent = this.translate("MONITORON");
          monitorBtnIcon.className = "fa fa-fw fa-television";
        }
        return;
      }
      // 处理窗口最小化/恢复响应
      if ("minimized" in payload) {
        const minimizeBtn = document.getElementById("minimize-button");
        const minimizeBtnText = minimizeBtn.querySelector(".text");
        const minimizeBtnIcon = minimizeBtn.querySelector(".fa");

        if (payload.minimized) {
          // 窗口已最小化，按钮变为"恢复魔镜"
          minimizeBtnText.textContent = this.translate("RESTORE");
          minimizeBtnIcon.className = "fa fa-fw fa-window-maximize";
        } else {
          // 窗口已恢复，按钮变为"最小化魔镜"
          minimizeBtnText.textContent = this.translate("MINIMIZE");
          minimizeBtnIcon.className = "fa fa-fw fa-window-minimize";
        }
        return;
      }
      if ("success" in payload) {
        if (!("status" in payload)) {
          payload.status = payload.success
            ? "success"
            : "error";
        }
        let message;
        if (payload.status === "error") {
          // 优先显示具体的错误消息
          if (payload.message) {
            message = `<strong>错误:</strong> ${payload.message.replace(/\n/g, '<br>')}`;
          } else if (payload.reason) {
            const reasonMap = {
              "git_error": "Git 操作失败",
              "npm_install_failed": "npm 安装失败",
              "git_reset_failed": "Git reset 失败",
              "network_error": "网络错误",
              "private_repo": "私有仓库",
              "repo_not_found": "仓库未找到",
              "unknown": "未知错误"
            };
            const reasonText = reasonMap[payload.reason] || payload.reason;
            message = `<strong>${reasonText}</strong>`;
            if (payload.info && typeof payload.info === 'string') {
              message += `<br>${payload.info}`;
            }
          } else {
            message = `${this.translate("RESPONSE_ERROR")}: <br><pre><code>${JSON.stringify(payload, undefined, 3)}</code></pre>`;
          }
        } else {
          message = payload.info;
        }
        this.setStatus(payload.status, message);
        return;
      }
    }
    if (notification === "REFRESH") {
      setTimeout(() => { document.location.reload(); }, 2000);
      return;
    }
    if (notification === "RESTART") {
      setTimeout(() => {
        document.location.reload();
      }, 62000);
      return;
    }
    if (notification === "REMOTE_CLIENT_CUSTOM_MENU") {
      this.customMenu = payload;
      this.createDynamicMenu(this.customMenu);
      return;
    }
    if (notification === "REMOTE_CLIENT_MODULEAPI_MENU") {
      this.moduleApiMenu = payload;
      this.createDynamicMenu(this.moduleApiMenu);

    }
  },

  loadButtons (buttons) {
    Object.keys(buttons).forEach((key) => {
      document.getElementById(key).addEventListener("click", buttons[key], false);
    });
  },

  translate (pattern) {
    return this.translations[pattern];
  },

  hasClass (element, name) {
    return ` ${element.className} `.indexOf(` ${name} `) > -1;
  },

  hide (element) {
    if (!this.hasClass(element, "hidden")) {
      element.className += " hidden";
    }
  },

  show (element) {
    if (this.hasClass(element, "hidden")) {
      element.className = element.className.replace(/ ?hidden/, "");
    }
  },

  loadToggleButton (element, toggleCallback) {
    const self = this;

    element.addEventListener("click", (event) => {
      if (self.hasClass(event.currentTarget, "toggled-off")) {
        if (toggleCallback) {
          toggleCallback(true, event);
        }
      } else if (toggleCallback) {
        toggleCallback(false, event);
      }
    }, false);
  },

  filter (pattern) {
    let filterInstalled = false;
    if ("installed".indexOf(pattern) !== -1) {
      filterInstalled = true;
      pattern = pattern.replace("installed");
    }
    pattern = pattern.trim();

    const regex = new RegExp(pattern, "i");
    const searchIn = ["author", "desc", "longname", "name"];

    const data = this.savedData.moduleAvailable;
    for (let i = 0; i < data.length; i++) {
      const currentData = data[i];
      const id = `install-module-${i}`;
      const element = document.getElementById(id);
      if (pattern === "" || pattern === undefined) {
        // cleared search input, show all
        element.style.display = "";
        continue;
      }

      let match = false;
      if (filterInstalled && currentData.installed) {
        match = true;
      }
      for (let k = 0; k < searchIn.length; k++) {
        const key = searchIn[k];
        if (match || currentData[key] && currentData[key].match(regex)) {
          match = true;
          break;
        }
      }
      if (match) {
        element.style.display = "";
      } else {
        element.style.display = "none";
      }
    }
  },

  closePopup () {
    const popupContainer = document.getElementById("popup-container");
    const popupContents = document.getElementById("popup-contents");
    if (popupContainer) popupContainer.style.display = "none";
    if (popupContents) popupContents.innerHTML = "";
    // 关闭弹窗后重置面包屑到主菜单
    this.updateBreadcrumb("main-menu");
  },

  showPopup () {
    const popupContainer = document.getElementById("popup-container");
    if (popupContainer) popupContainer.style.display = "block";
  },

  getPopupContent (clear) {
    if (clear === undefined) {
      clear = true;
    }
    if (clear) {
      this.closePopup();
    }
    return document.getElementById("popup-contents");
  },

  loadOtherElements () {
    const self = this;

    const slider = document.getElementById("brightness-slider");
    slider.addEventListener("change", () => {
      self.sendSocketNotification("REMOTE_ACTION", {action: "BRIGHTNESS", value: slider.value});
    }, false);

    const slider2 = document.getElementById("temp-slider");
    slider2.addEventListener("change", () => {
      self.sendSocketNotification("REMOTE_ACTION", {action: "TEMP", value: slider2.value});
    }, false);

    const input = document.getElementById("add-module-search");
    const deleteButton = document.getElementById("delete-search-input");

    input.addEventListener("input", () => {
      self.filter(input.value);
      if (input.value === "") {
        deleteButton.style.display = "none";
      } else {
        deleteButton.style.display = "";
      }
    }, false);

    deleteButton.addEventListener("click", () => {
      input.value = "";
      self.filter(input.value);
      deleteButton.style.display = "none";
    }, false);

    // 面包屑点击事件：点击主标题返回主菜单
    const breadcrumbHome = document.getElementById("breadcrumb-home");
    breadcrumbHome.addEventListener("click", () => {
      if (self.currentMenu !== "main-menu") {
        window.location.hash = "main-menu";
      }
    }, false);

    // 查询显示器当前状态并设置按钮可见性
    self.sendSocketNotification("REMOTE_ACTION", {action: "MONITORSTATUS"});

    // 查询窗口最小化状态并设置按钮文字
    self.sendSocketNotification("REMOTE_ACTION", {action: "MINIMIZESTATUS"});

    // 页面加载时主动检查一次更新，显示小红点
    self.sendSocketNotification("REMOTE_ACTION", {data: "mmUpdateAvailable"});

  },

  /**
   * 更新面包屑导航
   * @param {string} menu - 当前菜单名称
   */
  updateBreadcrumb (menu) {
    const breadcrumbSeparator = document.getElementById("breadcrumb-separator");
    const breadcrumbCurrent = document.getElementById("breadcrumb-current");
    const breadcrumbHome = document.getElementById("breadcrumb-home");

    // 菜单名称映射
    const menuNameMap = {
      "power-menu": "SHUTDOWN_MENU_NAME",
      "edit-menu": "EDIT_MENU_NAME",
      "settings-menu": "CONFIGURE_MENU_NAME",
      "update-menu": "UPDATE_MENU_NAME",
      "alert-menu": "ALERT_MENU_NAME",
      "add-module-menu": "ADD_MODULE",
      "classes-menu": "MODULE_CONTROLS"
    };

    if (menu === "main-menu") {
      // 主菜单：只显示主标题
      this.hide(breadcrumbSeparator);
      this.hide(breadcrumbCurrent);
      breadcrumbCurrent.textContent = "";  // 清空内容
      breadcrumbHome.style.cursor = "default";
    } else {
      // 子菜单：显示面包屑
      const menuNameKey = menuNameMap[menu];
      if (menuNameKey) {
        breadcrumbCurrent.textContent = this.translate(menuNameKey);
        this.show(breadcrumbSeparator);
        this.show(breadcrumbCurrent);
        breadcrumbHome.style.cursor = "pointer";
      }
    }
  },

  showMenu (newMenu) {
    const self = this;
    if (this.currentMenu === "settings-menu") {
      // check for unsaved changes
      const changes = this.deletedModules.length + this.changedModules.length;
      if (changes > 0) {
        const wrapper = document.createElement("div");
        const text = document.createElement("span");
        text.innerHTML = this.translate("UNSAVED_CHANGES");
        wrapper.appendChild(text);

        const ok = self.createSymbolText("fa fa-check-circle", this.translate("OK"), () => {
          self.setStatus("none");
        });
        wrapper.appendChild(ok);

        const discard = self.createSymbolText("fa fa-warning", this.translate("DISCARD"), () => {
          self.deletedModules = [];
          self.changedModules = [];
          window.location.hash = newMenu;
        });
        wrapper.appendChild(discard);

        this.setStatus(false, false, wrapper);

        this.skipHashChange = true;
        window.location.hash = this.currentMenu;

        return;
      }
    }

    // 更新面包屑
    this.updateBreadcrumb(newMenu);

    const belowFold = document.getElementById("below-fold");
    if (newMenu === "main-menu") {
      if (!this.hasClass(belowFold, "hide-border")) {
        belowFold.className += " hide-border";
      }
    } else if (this.hasClass(belowFold, "hide-border")) {
      belowFold.className = belowFold.className.replace(" hide-border", "");
    }
    if (newMenu === "add-module-menu") {
      this.loadModulesToAdd();
    }
    if (newMenu === "edit-menu") {
      this.loadVisibleModules();
      this.loadBrightness();
      this.loadTemp();
    }
    if (newMenu === "settings-menu") {
      this.loadConfigModules();
    }
    if (newMenu === "classes-menu") {
      this.loadClasses();
    }
    if (newMenu === "update-menu") {
      this.loadModulesToUpdate();
    }

    if (newMenu === "main-menu") {
      this.loadList("config-modules", "config", (parent, configData) => {

        const alertElem = document.getElementById("alert-button");
        if (!configData.modules.find((m) => m.module === "alert") && alertElem !== undefined) { alertElem.remove(); }

        const modConfig = configData.modules.find((m) => m.module === "MMM-TMM-Control").config;
        const classesButton = document.getElementById("classes-button");
        if ((!modConfig || !modConfig.classes) && classesButton) { classesButton.remove(); }

      });
    }

    const allMenus = document.getElementsByClassName("menu-element");

    for (let i = 0; i < allMenus.length; i++) {
      this.hide(allMenus[i]);
    }

    const currentMenu = document.getElementsByClassName(newMenu);

    for (let i = 0; i < currentMenu.length; i++) {
      this.show(currentMenu[i]);
    }

    this.setStatus("none");

    this.currentMenu = newMenu;
  },

  setStatus (status, message, customContent) {
    const self = this;

    if (this.autoHideTimer !== undefined) {
      clearTimeout(this.autoHideTimer);
    }

    // Simple status update
    if (status === "success" && !message && !customContent) {
      const successPopup = document.getElementById("success-popup");
      successPopup.style.display = "block";
      this.autoHideTimer = setTimeout(() => { successPopup.style.display = "none"; }, this.autoHideDelay);
      return;
    }

    const parent = document.getElementById("result-contents");
    while (parent.firstChild) {
      parent.removeChild(parent.firstChild);
    }

    if (status === "none") {
      this.hide(document.getElementById("result-overlay"));
      this.hide(document.getElementById("result"));
      return;
    }

    if (customContent) {
      parent.appendChild(customContent);
      this.show(document.getElementById("result-overlay"));
      this.show(document.getElementById("result"));
      return;
    }

    let symbol;
    let text;
    let onClick;
    if (status === "loading") {
      symbol = "fa-spinner fa-pulse";
      text = this.translate("LOADING");
      onClick = false;
    }
    if (status === "error") {
      symbol = "fa-exclamation-circle";
      text = this.translate("ERROR");
      onClick = function () {
        self.setStatus("none");
      };
      // Only auto-hide errors if autoHideDelayError > 0, otherwise user must click to dismiss
      if (this.autoHideDelayError > 0) {
        this.autoHideTimer = setTimeout(() => {
          self.setStatus("none");
        }, this.autoHideDelayError);
      }
    }
    if (status === "info") {
      symbol = "fa-info-circle";
      text = this.translate("INFO");
      onClick = function () {
        self.setStatus("none");
      };
      // Info messages (like PM2 restart/stop) should be displayed longer
      if (this.autoHideDelayInfo > 0) {
        this.autoHideTimer = setTimeout(() => {
          self.setStatus("none");
        }, this.autoHideDelayInfo);
      }
    }
    if (status === "success") {
      symbol = "fa-check-circle";
      text = this.translate("DONE");
      onClick = function () {
        self.setStatus("none");
      };
      this.autoHideTimer = setTimeout(() => {
        self.setStatus("none");
      }, this.autoHideDelay);
    }
    if (message) {
      text = typeof message === "object" ? JSON.stringify(message, undefined, 3) : message;
    }
    parent.appendChild(this.createSymbolText(`fa fa-fw ${symbol}`, text, onClick));

    this.show(document.getElementById("result-overlay"));
    this.show(document.getElementById("result"));
  },

  getWithStatus (params, callback) {
    const self = this;

    self.setStatus("loading");
    self.get("remote", params, (response) => {
      if (callback) {
        callback(response);
      } else {
        const result = JSON.parse(response);
        if (result.success) {
          if (result.info) {
            self.setStatus("success", result.info);
          } else {
            self.setStatus("success");
          }
        } else {
          self.setStatus("error");
        }
      }
    });
  },

  showModule (id, force) {
    if (force) {
      this.sendSocketNotification("REMOTE_ACTION", {action: "SHOW", force: true, module: id});
    } else {
      this.sendSocketNotification("REMOTE_ACTION", {action: "SHOW", module: id});
    }
  },

  hideModule (id) {
    this.sendSocketNotification("REMOTE_ACTION", {action: "HIDE", module: id});
  },

  install (url, index) {
    const self = this;

    const downloadButton = document.getElementById("download-button");
    const icon = downloadButton.querySelector("span:first-child");
    const text = downloadButton.querySelector("span:last-child");

    if (icon) {
      icon.classList.remove("fa-download");
      icon.classList.add("fa-spinner", "fa-pulse");
    }

    if (text) {
      text.innerHTML = ` ${self.translate("DOWNLOADING")}`;
    }

    this.sendSocketNotification("REMOTE_ACTION", {action: "INSTALL", url, index});
  },

  installCallback (result) {
    if (result.success) {
      const bgElement = document.getElementById(`install-module-${result.index}`);
      bgElement.firstChild.className = "fa fa-fw fa-check-circle";
      this.savedData.moduleAvailable[result.index].installed = true;
      this.createAddingPopup(result.index);
    }
  },

  async get (route, params, callback, timeout) {
    const url = `${route}?${params}`;
    const controller = new AbortController();
    const signal = controller.signal;

    if (timeout) {
      setTimeout(() => controller.abort(), timeout); // Timeout in milliseconds
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-type": "application/x-www-form-urlencoded"
        },
        signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status} - ${response.statusText}`);
      }

      const text = await response.text();
      if (callback) {
        console.error("Callback:", text);
        callback(text);
      }
    } catch (error) {
      if (error.name === "AbortError") {
        console.error("Request was aborted.");
        // Provide user feedback
        const errorMessage = document.createElement("div");
        errorMessage.className = "error-message";
        errorMessage.innerText = "The request was aborted. Please try again.";
        document.body.appendChild(errorMessage);
      } else {
        console.error("Fetch error:", error);
      }
    }
  },

  loadList (listname, dataId, callback) {
    const self = this;

    const loadingIndicator = document.getElementById(`${listname}-loading`);
    const parent = document.getElementById(`${listname}-results`);

    while (parent.firstChild) {
      parent.removeChild(parent.firstChild);
    }
    self.show(loadingIndicator);
    if (callback) { self.pendingCallback = callback; }
    self.sendSocketNotification("REMOTE_ACTION", {data: dataId, listname});
  },

  loadListCallback (result) {
    const self = this;

    const loadingIndicator = document.getElementById(`${result.query.listname}-loading`);
    const emptyIndicator = document.getElementById(`${result.query.listname}-empty`);
    const parent = document.getElementById(`${result.query.listname}-results`);

    self.hide(loadingIndicator);
    self.savedData[result.query.data] = false;

    try {
      if (result.data.length === 0) {
        self.show(emptyIndicator);
      } else {
        self.hide(emptyIndicator);
      }
      self.savedData[result.query.data] = result.data;
      if (self.pendingCallback) {
        self.pendingCallback(parent, result.data);
        delete self.pendingCallback;
      }
    } catch (error) {
      console.debug("Error loading list:", error);
      self.show(emptyIndicator);
    }
  },

  formatName (string) {
    string = string.replace(/MMM?-/ig, "").replace(/_/g, " ").replace(/-/g, " ");
    string = string.replace(/([a-z])([A-Z])/g, function (txt) {
      // insert space into camel case
      return `${txt.charAt(0)} ${txt.charAt(1)}`;
    });
    string = string.replace(/\w\S*/g, function (txt) {
      // make character after white space upper case
      return txt.charAt(0).toUpperCase() + txt.substr(1);
    });
    return string.charAt(0).toUpperCase() + string.slice(1);
  },

  formatLabel (string) {

    /*
     * let result = string.replace(/([A-Z])/g, " $1" );
     * return result.charAt(0).toUpperCase() + result.slice(1);
     */
    return string;
  },

  formatPosition (string) {
    return string.replace("_", " ").replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
  },

  getVisibilityStatus (data) {
    let status = "toggled-on";
    const modules = [];
    if (data.hidden) {
      status = "toggled-off";
      for (let i = 0; i < data.lockStrings.length; i++) {
        if (data.lockStrings[i].indexOf("MMM-TMM-Control") >= 0) {
          continue;
        }
        modules.push(data.lockStrings[i]);
        if (modules.length == 1) {
          status += " external-locked";
        }
      }
    }
    return {status, modules: modules.join(", ")};
  },

  addToggleElements (parent) {
    const outerSpan = document.createElement("span");
    outerSpan.className = "stack fa-fw";

    const spanClasses = [
      "fa fa-fw fa-toggle-on outer-label fa-stack-1x",
      "fa fa-fw fa-toggle-off outer-label fa-stack-1x",
      "fa fa-fw fa-lock inner-small-label fa-stack-1x"
    ];

    for (let i = 0; i < spanClasses.length; i++) {
      const innerSpan = document.createElement("span");
      innerSpan.className = spanClasses[i];
      outerSpan.appendChild(innerSpan);
    }

    parent.appendChild(outerSpan);
  },

  loadBrightness () {
    this.sendSocketNotification("REMOTE_ACTION", {data: "brightness"});
  },

  loadTemp () {
    this.sendSocketNotification("REMOTE_ACTION", {data: "temp"});
  },

  makeToggleButton (moduleBox, visibilityStatus) {
    const self = this;

    self.loadToggleButton(moduleBox, (toggledOn, event) => {
      if (toggledOn) {
        if (self.hasClass(event.currentTarget, "external-locked")) {
          const wrapper = document.createElement("div");
          const warning = document.createElement("span");
          warning.innerHTML = self.translate("LOCKSTRING_WARNING").replace("LIST_OF_MODULES", visibilityStatus.modules);
          wrapper.appendChild(warning);

          const ok = self.createSymbolText("fa fa-check-circle", self.translate("OK"), () => {
            self.setStatus("none");
          });
          wrapper.appendChild(ok);

          const force = self.createSymbolText("fa fa-warning", self.translate("FORCE_SHOW"), (function (target) {
            return function () {
              target.className = target.className.replace(" external-locked", "").replace("toggled-off", "toggled-on");
              self.showModule(target.id, true);
              self.setStatus("none");
            };
          }(event.currentTarget)));
          wrapper.appendChild(force);

          self.setStatus("error", false, wrapper);
        } else {
          event.currentTarget.className = event.currentTarget.className.replace("toggled-off", "toggled-on");
          self.showModule(event.currentTarget.id);
        }
      } else {
        event.currentTarget.className = event.currentTarget.className.replace("toggled-on", "toggled-off");
        self.hideModule(event.currentTarget.id);
      }
    });
  },

  loadVisibleModules () {
    const self = this;


    this.loadList("visible-modules", "modules", (parent, moduleData) => {
      for (let i = 0; i < moduleData.length; i++) {
        if (!moduleData[i].position) {
          // skip invisible modules
          continue;
        }
        const visibilityStatus = self.getVisibilityStatus(moduleData[i]);

        const moduleBox = document.createElement("div");
        moduleBox.className = `button module-line ${visibilityStatus.status}`;
        moduleBox.id = moduleData[i].identifier;

        self.addToggleElements(moduleBox);

        const text = document.createElement("span");
        text.className = "text";
        text.innerHTML = ` ${self.formatName(moduleData[i].name)}`;
        if ("header" in moduleData[i]) {
          text.innerHTML += ` (${moduleData[i].header})`;
        }
        moduleBox.appendChild(text);

        parent.appendChild(moduleBox);

        self.makeToggleButton(moduleBox, visibilityStatus);
      }
    });
  },

  createSymbolText (symbol, text, eventListener, element) {
    if (element === undefined) {
      element = "div";
    }
    const wrapper = document.createElement(element);
    if (eventListener) {
      wrapper.className = "button";
    }
    const symbolElement = document.createElement("span");
    symbolElement.className = symbol;
    wrapper.appendChild(symbolElement);
    const textElement = document.createElement("span");
    textElement.innerHTML = text;
    textElement.className = "symbol-text-padding";
    wrapper.appendChild(textElement);
    if (eventListener) {
      wrapper.addEventListener("click", eventListener, false);
    }
    return wrapper;
  },

  recreateConfigElement (key, previousType, newType) {
    const input = document.getElementById(key);
    let oldGUI = input.parentNode;
    if (previousType === "array" || previousType === "object") {
      oldGUI = input;
    }
    const path = key.split("/");
    const name = path[path.length - 1];

    let current = this.currentConfig;
    for (let i = 1; i < path.length - 1; i++) {
      current = current[path[i]];
    }
    const initialValue = this.values[this.types.indexOf(newType)];
    const newGUI = this.createObjectGUI(key, name, initialValue);
    oldGUI.parentNode.replaceChild(newGUI, oldGUI);
  },

  createTypeEditSelection (key, parent, type, oldElement) {
    const self = this;

    const previousType = oldElement.children[1].innerHTML.slice(1).toLowerCase();
    const select = document.createElement("select");
    for (let i = 0; i < this.types.length; i++) {
      const option = document.createElement("option");
      option.innerHTML = this.formatName(this.types[i]);
      option.value = this.types[i];
      if (this.types[i] === type) {
        option.selected = "selected";
      }
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      const newType = select.options[select.selectedIndex].innerHTML.toLowerCase();
      if (previousType !== newType) {
        self.recreateConfigElement(key, previousType, newType);
      } else {
        parent.replaceChild(oldElement, select);
      }
    }, false);
    select.addEventListener("blur", () => {
      parent.replaceChild(oldElement, select);
    }, false);
    return select;
  },

  createConfigLabel (key, name, type, forcedType, symbol) {
    const self = this;

    if (symbol === undefined) {
      symbol = "fa-tag";
    }
    if (name[0] === "#") {
      symbol = "fa-hashtag";
      name = name.substring(1);
    }
    const label = document.createElement("label");
    label.htmlFor = key;
    label.className = "config-label";
    const desc = Remote.createSymbolText(`fa fa-fw ${symbol}`, this.formatLabel(name), false, "span");
    desc.className = "label-name";
    label.appendChild(desc);

    if (!forcedType) {
      const typeLabel = Remote.createSymbolText("fa fa-fw fa-pencil", this.formatName(type), (event) => {
        const thisElement = event.currentTarget;
        label.replaceChild(self.createTypeEditSelection(key, label, type, thisElement), thisElement);
      }, "span");
      typeLabel.className += " type-edit";
      label.appendChild(typeLabel);

      const remove = Remote.createSymbolText("fa fa-fw fa-times-circle", this.translate("DELETE_ENTRY"), (event) => {
        let thisElement = event.currentTarget;
        if (type === "array" || type === "object") {
          thisElement = thisElement.parentNode;
        }
        thisElement.parentNode.parentNode.removeChild(thisElement.parentNode);
      }, "span");
      remove.className += " type-edit";
      label.appendChild(remove);
    }
    return label;
  },

  createConfigInput (key, value, omitValue, element) {
    if (element === undefined) {
      element = "input";
    }
    const input = document.createElement(element);
    input.className = "config-input";
    if (!omitValue) {
      input.value = value;
    }
    input.id = key;
    input.addEventListener("focus", (event) => {
      const label = event.currentTarget.parentNode;
      label.className = `${label.className} highlight`;
    }, false);
    input.addEventListener("blur", (event) => {
      const label = event.currentTarget.parentNode;
      label.className = label.className.replace(" highlight", "");
    }, false);

    return input;
  },

  createVisualCheckbox (key, wrapper, input, className) {
    const visualCheckbox = document.createElement("span");
    visualCheckbox.className = `visual-checkbox fa fa-fw ${className}`;
    wrapper.appendChild(visualCheckbox);
  },

  createConfigElement (type) {
    const self = this;

    return {
      string (key, name, value, type, forcedType) {
        const label = self.createConfigLabel(key, name, type, forcedType);
        const input = self.createConfigInput(key, value);
        input.type = "text";
        label.appendChild(input);
        if (key === "<root>/header") {
          input.placeholder = self.translate("NO_HEADER");
        }
        return label;
      },
      number (key, name, value, type, forcedType) {
        const label = self.createConfigLabel(key, name, type, forcedType);
        const input = self.createConfigInput(key, value);
        input.type = "number";
        if (value % 1 !== 0) {
          input.step = 0.01;
        }
        label.appendChild(input);
        return label;
      },
      boolean (key, name, value, type, forcedType) {
        const label = self.createConfigLabel(key, name, type, forcedType);

        const input = self.createConfigInput(key, value, true);
        input.type = "checkbox";
        label.appendChild(input);
        if (value) {
          input.checked = true;
        }

        self.createVisualCheckbox(key, label, input, "fa-check-square-o", false);
        self.createVisualCheckbox(key, label, input, "fa-square-o", true);
        return label;
      },
      undefined (key, name, value, type, forcedType) {
        const label = self.createConfigLabel(key, name, type, forcedType);
        const input = self.createConfigInput(key, value);
        input.type = "text";
        input.disabled = "disabled";
        input.className += " disabled undefined";
        input.placeholder = "undefined";
        label.appendChild(input);
        return label;
      },
      null (key, name, value, type, forcedType) {
        const label = self.createConfigLabel(key, name, type, forcedType);
        const input = self.createConfigInput(key, value);
        input.type = "text";
        input.disabled = "disabled";
        input.className += " disabled null";
        input.placeholder = "null";
        label.appendChild(input);
        return label;
      },
      position (key, name, value, type, forcedType) {
        const label = self.createConfigLabel(key, name, type, forcedType);
        const select = self.createConfigInput(key, value, false, "select");
        select.className = "config-input";
        select.id = key;
        for (let i = 0; i < self.validPositions.length; i++) {
          const option = document.createElement("option");
          option.value = self.validPositions[i];
          if (self.validPositions[i]) {
            option.innerHTML = self.formatPosition(self.validPositions[i]);
          } else {
            option.innerHTML = self.translate("NO_POSITION");
          }
          if (self.validPositions[i] === value) {
            option.selected = "selected";
          }
          select.appendChild(option);
        }
        label.appendChild(select);
        return label;
      }
    }[type];
  },

  getTypeAsString (dataToEdit, path) {
    let type = typeof dataToEdit;
    if (path === "<root>/position") {
      type = "position";
    }
    if (this.createConfigElement(type)) {
      return type;
    }
    if (Array.isArray(dataToEdit)) {
      return "array";
    }
    if (dataToEdit === null) {
      return "null";
    }
    if (dataToEdit === undefined) {
      return "undefined";
    }
    return "object";
  },

  hasForcedType (path) {
    let forcedType = false;
    if ((path.match(/\//g) || []).length === 1) {
      // disable type editing in root layer
      forcedType = true;
    }
    return forcedType;
  },

  createObjectGUI (path, name, dataToEdit) {
    const self = this;

    const type = this.getTypeAsString(dataToEdit, path);
    const forcedType = this.hasForcedType(path);
    if (this.createConfigElement(type)) {
      // recursion stop
      return this.createConfigElement(type)(path, name, dataToEdit, type, forcedType);
    }

    // object and array
    const wrapper = document.createElement("div");
    wrapper.id = path;
    wrapper.className = `indent config-input ${type}`;
    if (type === "array") {
      // array
      const add = this.createSymbolText("fa fa-fw fa-plus", this.translate("ADD_ENTRY"));
      add.className += " bottom-spacing button";
      wrapper.appendChild(this.createConfigLabel(path, name, type, forcedType, "fa-list-ol"));
      wrapper.appendChild(add);
      for (let i = 0; i < dataToEdit.length; i++) {
        const newName = `#${i}`;
        wrapper.appendChild(this.createObjectGUI(`${path}/${newName}`, newName, dataToEdit[i]));
      }
      add.addEventListener("click", () => {
        const lastIndex = dataToEdit.length - 1;
        const lastType = self.getTypeAsString(`${path}/#${lastIndex}`, dataToEdit[lastIndex]);
        dataToEdit.push(self.values[self.types.indexOf(lastType)]);
        const nextName = `#${lastIndex + 1}`;
        wrapper.appendChild(self.createObjectGUI(`${path}/${nextName}`, nextName, dataToEdit[dataToEdit.length - 1]));
      }, false);
      return wrapper;
    }

    // object
    if (path !== "<root>") {
      wrapper.appendChild(this.createConfigLabel(path, name, type, forcedType, "fa-list-ul"));

      const addElement = self.createConfigLabel(`${path}/<add>`, this.translate("ADD_ENTRY"), type, true, "fa-plus");
      addElement.className += " bottom-spacing";
      const inputWrapper = document.createElement("div");
      inputWrapper.className = "add-input-wrapper";
      const input = self.createConfigInput(`${path}/<add>`, "");
      input.type = "text";
      input.placeholder = this.translate("NEW_ENTRY_NAME");
      addElement.appendChild(inputWrapper);
      inputWrapper.appendChild(input);
      const addFunction = function () {
        const existingKey = Object.keys(dataToEdit)[0];
        const lastType = self.getTypeAsString(`${path}/${existingKey}`, dataToEdit[existingKey]);
        const key = input.value;
        if (key === "" || document.getElementById(`${path}/${key}`)) {
          if (!self.hasClass(input, "input-error")) {
            input.className += " input-error";
          }
          return;
        }
        input.className = input.className.replace(" input-error", "");
        dataToEdit[key] = self.values[self.types.indexOf(lastType)];
        const newElement = self.createObjectGUI(`${path}/${key}`, key, dataToEdit[key]);
        wrapper.insertBefore(newElement, addElement.nextSibling);
        input.value = "";
      };
      const symbol = document.createElement("span");
      symbol.className = "fa fa-fw fa-plus-square button";
      symbol.addEventListener("click", addFunction, false);
      inputWrapper.appendChild(symbol);
      input.onkeypress = function (e) {
        if (!e) { e = window.event; }
        const keyCode = e.keyCode || e.which;
        if (keyCode == "13") {
          addFunction();
        }
      };
      wrapper.appendChild(addElement);
    }
    let keys = Object.keys(dataToEdit);
    if (path === "<root>") {
      keys = [
        "module",
        "disabled",
        "position",
        "header",
        "config"
      ];
    }
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (Object.hasOwn(dataToEdit, key)) {
        wrapper.appendChild(this.createObjectGUI(`${path}/${key}`, key, dataToEdit[key]));
      }
    }
    if (path === "<root>") {
      // additional css classes on root element
      wrapper.className = "flex-fill small";
    }
    return wrapper;
  },

  appendConfigMenu (index, wrapper) {
    const self = this;

    const menuElement = self.createSymbolText("small fa fa-fw fa-navicon", self.translate("MENU"), () => {
      const elements = document.getElementsByClassName("sub-menu");
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        if (self.hasClass(element, "hidden")) {
          element.className = element.className.replace("hidden", "");
        } else {
          element.className = `${element.className} hidden`;
        }
      }
    });
    menuElement.className += " fixed-size";
    wrapper.appendChild(menuElement);

    const menuDiv = document.createElement("div");
    menuDiv.className = "fixed-size sub-menu hidden";

    const help = self.createSymbolText("fa fa-fw fa-question-circle", self.translate("HELP"), () => {
      window.open(`config-help.html?module=${self.currentConfig.module}`, "_blank");
    });
    menuDiv.appendChild(help);
    const undo = self.createSymbolText("fa fa-fw fa-undo", self.translate("RESET"), () => {
      self.createConfigPopup(index);
    });
    menuDiv.appendChild(undo);
    const save = self.createSymbolText("fa fa-fw fa-save", self.translate("SAVE"), () => {
      self.savedData.config.modules[index] = self.getModuleConfigFromUI();
      self.changedModules.push(index);
      const parent = document.getElementById(`edit-module-${index}`).parentNode;

      // 检查是否已存在警告图标
      const existingWarning = parent.querySelector(".fa-warning");
      if (!existingWarning) {
        // 在删除按钮前插入警告图标
        const deleteBtn = parent.querySelector(".type-edit");
        if (deleteBtn) {
          parent.insertBefore(self.createChangedWarning(), deleteBtn);
        }
      }
      self.closePopup();
    });
    menuDiv.appendChild(save);

    wrapper.appendChild(menuDiv);

    const line = document.createElement("header");
    line.className = "header";
    wrapper.appendChild(line);
  },

  setValue (parent, name, value) {
    if (name.indexOf("#") !== -1) {
      parent.push(value);
    } else {
      parent[name] = value;
    }
  },

  navigate (parent, name) {
    if (name.indexOf("#") !== -1) {
      return parent[parent.length - 1];
    }
    return parent[name];

  },

  getModuleConfigFromUI () {
    const rootElement = {};
    const elements = document.getElementsByClassName("config-input");
    for (let i = 0; i < elements.length; i++) {
      const path = elements[i].id;
      const splitPath = path.split("/");
      let parent = rootElement;
      for (let k = 1; k < splitPath.length - 1; k++) {
        parent = this.navigate(parent, splitPath[k]);
      }
      const name = splitPath[splitPath.length - 1];
      if (this.hasClass(elements[i], "null")) {
        this.setValue(parent, name, null);
        continue;
      }
      if (this.hasClass(elements[i], "undefined")) {
        this.setValue(parent, name, undefined);
        continue;
      }
      if (this.hasClass(elements[i], "array")) {
        this.setValue(parent, name, []);
        continue;
      }
      if (this.hasClass(elements[i], "object")) {
        this.setValue(parent, name, {});
        continue;
      }

      let {value} = elements[i];
      if (name === "<add>" || path === "<root>/position" && value === "") {
        continue;
      }
      if (elements[i].type === "checkbox") {
        value = elements[i].checked;
      }
      if (elements[i].type === "number") {
        value = parseFloat(value);
      }
      this.setValue(parent, name, value);
    }
    return rootElement;
  },

  createConfigPopup (index) {
    const self = this;
    if (typeof index === "string") {
      index = parseInt(index);
    }

    const moduleData = this.savedData.config.modules;
    const data = moduleData[index];

    self.currentConfig = data;
    if (!("header" in self.currentConfig)) {
      self.currentConfig.header = "";
    }
    if (!("position" in self.currentConfig)) {
      self.currentConfig.position = "";
    }

    const wrapper = this.getPopupContent();

    const name = document.createElement("div");
    name.innerHTML = self.formatName(data.module);
    name.className = "bright title medium";
    wrapper.appendChild(name);

    const n = document.createElement("div");
    n.innerHTML = `${data.module} (#${index + 1})`;
    n.className = "subtitle xsmall dimmed";
    wrapper.appendChild(n);

    self.appendConfigMenu(index, wrapper);

    wrapper.append(self.createObjectGUI("<root>", "", self.currentConfig));

    // disable input for module name
    document.getElementById("<root>/module").disabled = true;
    document.getElementById("<root>/module").className += " disabled";

    this.showPopup();
  },

  createChangedWarning () {
    const self = this;
    const changed = Remote.createSymbolText("fa fa-fw fa-warning", this.translate("UNSAVED_CHANGES"), () => {
      const saveButton = document.getElementById("save-config");
      if (!self.hasClass(saveButton, "highlight")) {
        saveButton.className += " highlight";
      }
    }, "span");
    changed.className += " type-edit";
    return changed;
  },

  appendModuleEditElements (wrapper, moduleData) {
    const self = this;
    for (let i = 0; i < moduleData.length; i++) {
      const innerWrapper = document.createElement("div");
      innerWrapper.className = "module-line";
      innerWrapper.setAttribute("data-module-index", i);  // 添加索引标记

      // 【新增】拖拽把手
      const dragHandle = document.createElement("span");
      dragHandle.className = "drag-handle";
      dragHandle.innerHTML = '<span class="fa fa-fw fa-bars"></span>';
      innerWrapper.appendChild(dragHandle);

      const moduleBox = self.createSymbolText("fa fa-fw fa-pencil", self.formatName(moduleData[i].module), (event) => {
        const i = event.currentTarget.id.replace("edit-module-", "");
        self.createConfigPopup(i);
      }, "span");
      moduleBox.id = `edit-module-${i}`;
      innerWrapper.appendChild(moduleBox);

      if (self.changedModules.indexOf(i) !== -1) {
        innerWrapper.appendChild(self.createChangedWarning());
      }

      const remove = Remote.createSymbolText("fa fa-fw fa-times-circle", this.translate("DELETE_ENTRY"), (event) => {
        // 修改：因为添加了拖拽把手，需要找到第二个子元素（moduleBox）
        const moduleBox = event.currentTarget.parentNode.querySelector('[id^="edit-module-"]');
        const i = moduleBox.id.replace("edit-module-", "");
        self.deletedModules.push(parseInt(i));
        const thisElement = event.currentTarget;
        thisElement.parentNode.parentNode.removeChild(thisElement.parentNode);
      }, "span");
      remove.className += " type-edit";
      innerWrapper.appendChild(remove);

      wrapper.appendChild(innerWrapper);
    }

    // 【新增】初始化拖拽排序
    self.initSortable(wrapper);
  },

  // 【新增】初始化 Sortable 拖拽排序
  initSortable (wrapper) {
    const self = this;

    // 动态加载 Sortable.js（避免全局污染）
    if (typeof Sortable === "undefined") {
      const script = document.createElement("script");
      script.src = "modules/MMM-TMM-Control/node_modules/sortablejs/Sortable.min.js";
      script.onload = () => {
        self.createSortableInstance(wrapper);
      };
      script.onerror = () => {
        console.error("[MMM-TMM-Control] 无法加载 Sortable.js，拖拽排序功能不可用");
      };
      document.head.appendChild(script);
    } else {
      self.createSortableInstance(wrapper);
    }
  },

  // 【新增】创建 Sortable 实例
  createSortableInstance (wrapper) {
    const self = this;

    new Sortable(wrapper, {
      animation: 150,
      handle: ".drag-handle",  // 只能通过拖拽把手拖动
      draggable: ".module-line",
      ghostClass: "module-line-ghost",
      chosenClass: "module-line-chosen",
      dragClass: "module-line-drag",

      onEnd: (evt) => {
        // 拖拽结束后，更新 modules 数组顺序
        const oldIndex = evt.oldIndex;
        const newIndex = evt.newIndex;

        if (oldIndex !== newIndex) {
          // 更新配置数据（内存中）
          const modules = self.savedData.config.modules;
          const movedModule = modules.splice(oldIndex, 1)[0];
          modules.splice(newIndex, 0, movedModule);


          // 更新所有模块行的索引和 ID（不重新加载数据）
          const moduleLines = wrapper.querySelectorAll(".module-line");
          moduleLines.forEach((line, index) => {
            // 更新 data-module-index
            line.setAttribute("data-module-index", index);

            // 更新模块编辑按钮的 ID
            const editBtn = line.querySelector('[id^="edit-module-"]');
            if (editBtn) {
              editBtn.id = `edit-module-${index}`;
            }

            // 只标记被拖拽的模块（新位置）
            if (index === newIndex) {
              // 添加修改警告图标（如果还没有）
              const existingWarning = line.querySelector(".fa-warning");
              if (!existingWarning) {
                const deleteBtn = line.querySelector(".type-edit");
                if (deleteBtn) {
                  line.insertBefore(self.createChangedWarning(), deleteBtn);
                }
              }

              // 标记为已修改
              if (self.changedModules.indexOf(index) === -1) {
                self.changedModules.push(index);
              }
            }
          });

        }
      }
    });
  },

  loadConfigModules () {
    const self = this;

    this.changedModules = [];

    this.loadList("config-modules", "config", (parent, configData) => {
      const moduleData = configData.modules;
      if (self.addModule) {
        const name = self.addModule;
        // we came here from adding a module
        self.get("get", `data=defaultConfig&module=${name}`, (response) => {
          const newData = JSON.parse(response);
          moduleData.push({module: name, config: newData.data});
          const index = moduleData.length - 1;
          self.changedModules.push(index);
          self.appendModuleEditElements(parent, moduleData);
          self.createConfigPopup(index);
        });
        self.addModule = "";
      } else {
        self.appendModuleEditElements(parent, moduleData);
      }
    });
  },

  loadClasses () {
    const self = this;

    this.loadList("classes", "classes", (parent, classes) => {
      for (const i in classes) {
        const node = document.createElement("div");
        node.id = "classes-before-result";
        node.hidden = true;
        document.getElementById("classes-results").appendChild(node);

        const content = {
          id: i,
          text: i,
          icon: "dot-circle-o",
          type: "item",
          action: "MANAGE_CLASSES",
          content: {
            payload: {
              classes: i
            }
          }
        };

        const existingButton = document.getElementById(`${content.id}-button`);
        if (existingButton) {
          existingButton.remove();
        }

        self.createMenuElement(content, "classes", node);
      }
    });
  },

  createAddingPopup (index) {
    const self = this;
    if (typeof index === "string") {
      index = parseInt(index);
    }

    const data = this.savedData.moduleAvailable[index];
    const wrapper = this.getPopupContent();

    const name = document.createElement("div");
    name.innerHTML = data.name;
    name.className = "bright title";
    wrapper.appendChild(name);

    const author = document.createElement("div");
    author.innerHTML = `${self.translate("BY")} ${data.author}`;
    author.className = "subtitle small";
    wrapper.appendChild(author);

    const desc = document.createElement("div");
    desc.innerHTML = data.desc;
    desc.className = "small flex-fill";
    wrapper.appendChild(desc);

    const footer = document.createElement("div");
    footer.className = "fixed-size sub-menu";

    if (data.installed) {
      const add = self.createSymbolText("fa fa-fw fa-plus", self.translate("ADD_THIS"), () => {
        self.closePopup();
        self.addModule = data.longname;
        window.location.hash = "settings-menu";
      });
      footer.appendChild(add);
    }

    if (data.installed) {
      const statusElement = self.createSymbolText("fa fa-fw fa-check-circle", self.translate("INSTALLED"));
      footer.appendChild(statusElement);
    } else {
      const statusElement = self.createSymbolText("fa fa-fw fa-download", self.translate("DOWNLOAD"), () => {
        self.install(data.url, index);
      });
      statusElement.id = "download-button";
      footer.appendChild(statusElement);
    }

    const githubElement = self.createSymbolText("fa fa-fw fa-github", self.translate("CODE_LINK"), () => {
      window.open(data.url, "_blank");
    });
    footer.appendChild(githubElement);

    wrapper.appendChild(footer);

    this.showPopup();
  },

  loadModulesToAdd () {
    const self = this;


    this.loadList("add-module", "moduleAvailable", (parent, modules) => {
      for (let i = 0; i < modules.length; i++) {
        let symbol = "fa fa-fw fa-cloud";
        if (modules[i].installed) {
          symbol = "fa fa-fw fa-check-circle";
        }

        const moduleBox = self.createSymbolText(symbol, modules[i].name, (event) => {
          const index = event.currentTarget.id.replace("install-module-", "");
          self.createAddingPopup(index);
        });
        moduleBox.className = "button module-line";
        moduleBox.id = `install-module-${i}`;
        parent.appendChild(moduleBox);
      }
    });
  },

  offerRestart (message) {
    const wrapper = document.createElement("div");

    const info = document.createElement("span");
    info.innerHTML = message;
    wrapper.appendChild(info);

    const restart = this.createSymbolText("fa fa-fw fa-recycle", this.translate("RESTARTMM"), buttons["restart-mm-button"]);
    restart.children[1].className += " text";
    wrapper.appendChild(restart);
    this.setStatus("success", false, wrapper);
  },

  offerReload (message) {
    const wrapper = document.createElement("div");

    const info = document.createElement("span");
    info.innerHTML = message;
    wrapper.appendChild(info);

    const restart = this.createSymbolText("fa fa-fw fa-recycle", this.translate("RESTARTMM"), buttons["restart-mm-button"]);
    restart.children[1].className += " text";
    wrapper.appendChild(restart);

    const reload = this.createSymbolText("fa fa-fw fa-globe", this.translate("REFRESHMM"), buttons["refresh-mm-button"]);
    reload.children[1].className += " text";
    wrapper.appendChild(reload);

    this.setStatus("success", false, wrapper);
  },

  offerOptions (message, data) {
    const wrapper = document.createElement("div");
    const info = document.createElement("span");
    info.innerHTML = message;
    wrapper.appendChild(info);

    for (const b in data) {
      const restart = this.createSymbolText("fa fa-fw fa-recycle", b, data[b]);
      restart.children[1].className += " text";
      wrapper.appendChild(restart);
    }

    this.setStatus("success", false, wrapper);
  },

  updateModule (module) {
    this.sendSocketNotification("REMOTE_ACTION", {action: "UPDATE", module});
  },

  mmUpdateCallback (result) {

    // 更新"更新"菜单页面内的状态元素
    if (window.location.hash.substring(1) == "update-menu") {
      const element = document.getElementById("update-mm-status");
      if (element) {
        if (result) {
          self.show(element);
        } else {
          self.hide(element);
        }
      }
    }

    // 无论在哪个页面，都更新主菜单的"更新"按钮提示小红点
    const notificationDot = document.getElementById("update-notification-dot");
    if (notificationDot) {
      if (result) {
        // 有更新：显示呼吸灯小红点
        notificationDot.classList.remove("hidden");
      } else {
        // 无更新：隐藏小红点
        notificationDot.classList.add("hidden");
      }
    }
  },

  loadModulesToUpdate () {
    const self = this;


    // also update mm info notification
    this.sendSocketNotification("REMOTE_ACTION", {data: "mmUpdateAvailable"});

    this.loadList("update-module", "moduleInstalled", (parent, modules) => {
      for (let i = 0; i < modules.length; i++) {
        const symbol = "fa fa-fw fa-toggle-up";
        const innerWrapper = document.createElement("div");
        innerWrapper.className = "module-line";

        const moduleBox = self.createSymbolText(symbol, modules[i].name, (event) => {
          const module = event.currentTarget.id.replace("update-module-", "");
          self.updateModule(module);
        });
        moduleBox.className = "button";
        if (modules[i].updateAvailable) {
          moduleBox.className += " bright";
        }
        moduleBox.id = `update-module-${modules[i].longname}`;
        innerWrapper.appendChild(moduleBox);

        if (modules[i].updateAvailable) {
          const moduleBox = self.createSymbolText("fa fa-fw fa-info-circle", self.translate("UPDATE_AVAILABLE"));
          innerWrapper.appendChild(moduleBox);
        }

        parent.appendChild(innerWrapper);
      }
    });
  },

  undoConfigMenu () {
    if (this.saving) {
      return;
    }
    const undoButton = document.getElementById("undo-config");
    undoButton.className = undoButton.className.replace(" highlight", "");
    this.setStatus("loading");
    this.sendSocketNotification("REMOTE_ACTION", {data: "saves"});
  },

  undoConfigMenuCallback (result) {
    const self = this;

    if (result.success) {
      const dates = {};
      for (const i in result.data) {
        dates[new Date(result.data[i])] = function () {
          self.undoConfig(result.data[i]);
        };
      }
      self.offerOptions(self.translate("DONE"), dates);
    } else {
      self.setStatus("error");
    }
  },

  undoConfig (date) {
    // prevent saving before current saving is finished
    if (this.saving) {
      return;
    }
    this.saving = true;
    this.setStatus("loading");

    this.sendSocketNotification("UNDO_CONFIG", date);
  },

  saveConfig () {
    // prevent saving before current saving is finished
    if (this.saving) {
      return;
    }
    const saveButton = document.getElementById("save-config");
    saveButton.className = saveButton.className.replace(" highlight", "");
    this.saving = true;
    this.setStatus("loading");
    const configData = this.savedData.config;
    const remainingModules = [];
    for (let i = 0; i < configData.modules.length; i++) {
      if (this.deletedModules.indexOf(i) !== -1) {
        continue;
      } else {
        remainingModules.push(configData.modules[i]);
      }
    }
    configData.modules = remainingModules;
    this.deletedModules = [];
    this.sendSocketNotification("NEW_CONFIG", configData);
  },

  saveConfigCallback (result) {
    const self = this;

    if (result.success) {
      self.offerReload(self.translate("DONE"));
    } else {
      self.setStatus("error");
    }
    self.saving = false;
    self.loadConfigModules();
  },

  onTranslationsLoaded () {
    this.createDynamicMenu();
  },

  createMenuElement (content, menu, insertAfter) {
    if (!content) { return; }
    const item = document.createElement("div");
    item.id = `${content.id}-button`;
    item.className = `menu-element button ${menu}-menu`;

    if (content.icon) {
      const mcmIcon = document.createElement("span");
      mcmIcon.className = `fa fa-fw fa-${content.icon}`;
      mcmIcon.setAttribute("aria-hidden", "true");
      item.appendChild(mcmIcon);
    }

    if (content.text) {
      const mcmText = document.createElement("span");
      mcmText.className = "text";
      mcmText.textContent = content.text;
      item.appendChild(mcmText);
    }

    if (content.type === "menu") {
      const mcmArrow = document.createElement("span");
      mcmArrow.className = "fa fa-fw fa-angle-right";
      mcmArrow.setAttribute("aria-hidden", "true");
      item.appendChild(mcmArrow);
      item.setAttribute("data-parent", menu);
      item.setAttribute("data-type", "menu");
      document.getElementById("back-button").classList.add(`${content.id}-menu`);
      document.getElementById("below-fold").classList.add(`${content.id}-menu`);
      item.addEventListener("click", () => {
        window.location.hash = `${content.id}-menu`;
      });
    } else if (content.type === "slider") {
      const contain = document.createElement("div");
      contain.style.flex = "1";

      const slide = document.createElement("input");
      slide.id = `${content.id}-slider`;
      slide.className = "slider";
      slide.type = "range";
      slide.min = content.min || 0;
      slide.max = content.max || 100;
      slide.step = content.step || 10;
      slide.value = content.defaultValue || 50;

      slide.addEventListener("change", () => {
        this.sendSocketNotification("REMOTE_ACTION", {
          action: content.action.toUpperCase(),
          ...content.content,
          payload: {
            ...content.content === undefined ? {} : typeof content.content.payload === "string" ? {string: content.content.payload} : content.content.payload,
            value: slide.value
          },
          value: slide.value
        });
      });

      contain.appendChild(slide);
      item.appendChild(contain);
    } else if (content.type === "input") {
      const input = document.createElement("input");
      input.id = `${content.id}-input`;
      input.className = `menu-element ${menu}-menu medium`;
      input.type = "text";
      input.placeholder = content.text || "";

      input.addEventListener("focusout", () => {
        this.sendSocketNotification("REMOTE_ACTION", {
          action: content.action.toUpperCase(),
          ...content.content,
          payload: {
            ...content.content === undefined ? {} : typeof content.content.payload === "string" ? {string: content.content.payload} : content.content.payload,
            value: input.value
          },
          value: input.value
        });
      });

      return input;
    } else if (content.action && content.content) {
      item.setAttribute("data-type", "item");
      item.addEventListener("click", () => {
        this.sendSocketNotification("REMOTE_ACTION", {
          action: content.action.toUpperCase(),
          payload: {},
          ...content.content
        });
      });
    }

    if (!window.location.hash && menu !== "main" ||
      window.location.hash && window.location.hash.substring(1) !== `${menu}-menu`) {
      item.classList.add("hidden");
    }

    insertAfter.parentNode.insertBefore(item, insertAfter.nextSibling);

    if ("items" in content) {
      content.items.forEach((i) => {
        this.createMenuElement(i, content.id, item);
      });
    }

    return item;
  },

  createDynamicMenu (content) {
    if (content) {
      const buttonElement = document.getElementById(`${content.id}-button`);
      if (buttonElement) {
        buttonElement.remove();
      }

      const menuElements = document.querySelectorAll(`.${content.id}-menu`);
      menuElements.forEach((menuElement) => menuElement.remove());

      if (window.location.hash === `#${content.id}-menu`) {
        window.location.hash = "main-menu";
      }
    }
    this.createMenuElement(content, "main", document.getElementById("alert-button"));
  }
};

const buttons = {
  // navigation buttons
  "power-button" () {
    window.location.hash = "power-menu";
  },
  "edit-button" () {
    window.location.hash = "edit-menu";
  },
  "settings-button" () {
    const self = Remote;

    const wrapper = document.createElement("div");
    const text = document.createElement("span");
    text.innerHTML = self.translate("EXPERIMENTAL");
    wrapper.appendChild(text);

    const panic = self.createSymbolText("fa fa-life-ring", self.translate("PANIC"), () => {
      self.setStatus("none");
    });
    wrapper.appendChild(panic);

    const danger = self.createSymbolText("fa fa-warning", self.translate("NO_RISK_NO_FUN"), () => {
      window.location.hash = "settings-menu";
    });
    wrapper.appendChild(danger);

    self.setStatus(false, false, wrapper);
  },
  "mirror-link-button" () {
    window.open("/", "_blank");
  },
  "classes-button" () {
    window.location.hash = "classes-menu";
  },
  "back-button" () {
    if (window.location.hash === "#add-module-menu") {
      window.location.hash = "settings-menu";
      return;
    }
    const currentButton = document.querySelector(window.location.hash.replace("-menu", "-button"));
    if (currentButton && currentButton.dataset.parent) {
      window.location.hash = `${currentButton.dataset.parent}-menu`;
      return;
    }
    window.location.hash = "main-menu";
  },
  "update-button" () {
    window.location.hash = "update-menu";
  },
  "alert-button" () {
    window.location.hash = "alert-menu";
  },

  // settings menu buttons
  "brightness-reset" () {
    const element = document.getElementById("brightness-slider");
    element.value = 100;
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "BRIGHTNESS", value: element.value});
  },

  "temp-reset" () {
    const element = document.getElementById("temp-slider");
    element.value = 327;
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "TEMP", value: element.value});
  },

  // edit menu buttons
  "show-all-button" () {
    const parent = document.getElementById("visible-modules-results");
    const buttons = parent.children;
    for (let i = 0; i < buttons.length; i++) {
      if (Remote.hasClass(buttons[i], "external-locked")) {
        continue;
      }
      buttons[i].className = buttons[i].className.replace("toggled-off", "toggled-on");
      Remote.showModule(buttons[i].id);
    }
  },
  "hide-all-button" () {
    const parent = document.getElementById("visible-modules-results");
    const buttons = parent.children;
    for (let i = 0; i < buttons.length; i++) {
      buttons[i].className = buttons[i].className.replace("toggled-on", "toggled-off");
      Remote.hideModule(buttons[i].id);
    }
  },

  // power menu buttons
  "shut-down-button" () {
    const self = Remote;

    const wrapper = document.createElement("div");
    const text = document.createElement("span");
    text.innerHTML = self.translate("CONFIRM_SHUTDOWN");
    wrapper.appendChild(text);

    const ok = self.createSymbolText("fa fa-power-off", self.translate("SHUTDOWN"), () => {
      Remote.sendSocketNotification("REMOTE_ACTION", {action: "SHUTDOWN"});
    });
    wrapper.appendChild(ok);

    const cancel = self.createSymbolText("fa fa-times", self.translate("CANCEL"), () => {
      self.setStatus("none");
    });
    wrapper.appendChild(cancel);

    self.setStatus(false, false, wrapper);
  },
  "restart-button" () {
    const self = Remote;

    const wrapper = document.createElement("div");
    const text = document.createElement("span");
    text.innerHTML = self.translate("CONFIRM_RESTART");
    wrapper.appendChild(text);

    const ok = self.createSymbolText("fa fa-refresh", self.translate("RESTART"), () => {
      Remote.sendSocketNotification("REMOTE_ACTION", {action: "REBOOT"});
    });
    wrapper.appendChild(ok);

    const cancel = self.createSymbolText("fa fa-times", self.translate("CANCEL"), () => {
      self.setStatus("none");
    });
    wrapper.appendChild(cancel);

    self.setStatus(false, false, wrapper);
  },
  "restart-mm-button" () {
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "RESTART"});
    setTimeout(() => {
      document.location.reload();
    }, 60000);
  },
  "stop-mm-button" () {
    const self = Remote;

    const wrapper = document.createElement("div");
    const text = document.createElement("span");
    text.innerHTML = self.translate("CONFIRM_STOP");
    wrapper.appendChild(text);

    const ok = self.createSymbolText("fa fa-stop-circle", self.translate("STOPMM"), () => {
      Remote.sendSocketNotification("REMOTE_ACTION", {action: "STOP"});
      self.setStatus("info", "MagicMirror² is stopping...");
    });
    wrapper.appendChild(ok);

    const cancel = self.createSymbolText("fa fa-times", self.translate("CANCEL"), () => {
      self.setStatus("none");
    });
    wrapper.appendChild(cancel);

    self.setStatus(false, false, wrapper);
  },
  "monitor-toggle-button" () {
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "MONITORTOGGLE"});
  },
  "refresh-mm-button" () {
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "REFRESH"});
  },
  "fullscreen-button" () {
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "TOGGLEFULLSCREEN"});
  },
  "minimize-button" () {
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "TOGGLEMINIMIZE"});
  },
  "devtools-button" () {
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "DEVTOOLS"});
  },

  // config menu buttons
  "add-module" () {
    window.location.hash = "add-module-menu";
  },
  "save-config" () {
    Remote.saveConfig();
  },

  "undo-config" () {
    Remote.undoConfigMenu();
  },
  // main menu
  "save-button" () {
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "SAVE"});
  },
  "close-popup" () {
    Remote.closePopup();
  },
  "close-result" () {
    Remote.setStatus("none");
  },

  // update Menu
  "update-mm-button" () {
    Remote.updateModule(undefined);
  },

  // alert menu
  "send-alert-button" () {
    const kvpairs = {};
    const form = document.getElementById("alert");
    for (let i = 0; i < form.elements.length; i++) {
      const e = form.elements[i];
      kvpairs[e.name] = e.value;
    }
    Remote.sendSocketNotification("REMOTE_ACTION", kvpairs);
  },
  "hide-alert-button" () {
    Remote.sendSocketNotification("REMOTE_ACTION", {action: "HIDE_ALERT"});
  }
};

// Initialize socket connection
Remote.sendSocketNotification("REMOTE_CLIENT_CONNECTED");
Remote.sendSocketNotification("REMOTE_ACTION", {data: "translations"});
Remote.loadButtons(buttons);
Remote.loadOtherElements();

Remote.setStatus("none");

// 系统详情面板功能 - 通用
Remote.initSystemDetailPanel = function () {
  const systemDetailPanel = document.getElementById("system-detail-panel");
  const systemDetailBack = document.getElementById("system-detail-back");
  const systemDetailTitle = document.getElementById("system-detail-title");
  const systemDetailContent = document.getElementById("system-detail-content");

  // 点击各个系统信息项
  const infoItems = [
    {id: "cpu-usage-item", title: "CPU 占用进程 TOP 5", type: "cpu"},
    {id: "memory-usage-item", title: "内存占用进程 TOP 5", type: "memory"},
    {id: "uptime-item", title: "系统运行进程", type: "uptime"},
    {id: "storage-usage-item", title: "存储占用详情", type: "storage"}
  ];

  infoItems.forEach((item) => {
    const element = document.getElementById(item.id);
    element.addEventListener("click", () => {
      systemDetailTitle.textContent = item.title;
      Remote.hide(document.querySelector(".system-info-right"));
      Remote.show(systemDetailPanel);
      Remote.loadSystemDetail(item.type);
    });
  });

  // 点击返回按钮
  systemDetailBack.addEventListener("click", () => {
    // 清除定时器
    if (Remote.systemDetailTimer) {
      clearInterval(Remote.systemDetailTimer);
      Remote.systemDetailTimer = null;
    }
    Remote.hide(systemDetailPanel);
    Remote.show(document.querySelector(".system-info-right"));
  });

  // 绑定清理垃圾按钮事件
  const cleanupBtn = document.getElementById("cleanup-trash-btn");
  if (cleanupBtn) {
    cleanupBtn.addEventListener("click", () => {
      Remote.cleanupTrash();
    });
  }
};

// 加载系统详情
Remote.loadSystemDetail = function (type) {
  const systemDetailContent = document.getElementById("system-detail-content");
  const cleanupBtn = document.getElementById("cleanup-trash-btn");

  systemDetailContent.innerHTML = '<div class="loading">加载中...</div>';

  // 控制清理垃圾按钮的显示
  if (type === "storage") {
    cleanupBtn.classList.remove("hidden");
  } else {
    cleanupBtn.classList.add("hidden");
  }

  // 清除之前的定时器
  if (Remote.systemDetailTimer) {
    clearInterval(Remote.systemDetailTimer);
    Remote.systemDetailTimer = null;
  }

  // 存储当前类型
  Remote.currentDetailType = type;

  // 加载初始数据
  Remote.fetchSystemDetail(type, systemDetailContent);

  // 对于 CPU/内存类型，2秒后开始实时刷新
  if (type === "cpu" || type === "memory") {
    setTimeout(() => {
      Remote.systemDetailTimer = setInterval(() => {
        Remote.fetchSystemDetail(type, systemDetailContent);
      }, 2000); // 每2秒刷新一次
    }, 2000); // 初始加载后等待2秒
  }
};

// 获取系统详情数据
Remote.fetchSystemDetail = function (type, container) {
  fetch(`/system-detail?type=${type}`)
    .then((response) => response.json())
    .then((data) => {
      if (data.directories && data.directories.length > 0) {
        // 存储类型：显示目录列表
        Remote.renderDirectoryList(data.directories, container);
      } else if (data.processes && data.processes.length > 0) {
        // CPU/内存类型：显示进程列表
        Remote.renderProcessList(data.processes, container);
      } else {
        container.innerHTML = '<div class="loading">无数据</div>';
      }
    })
    .catch((error) => {
      console.error("获取系统详情失败:", error);
      container.innerHTML = '<div class="loading">加载失败</div>';
    });
};

// 渲染目录列表（存储类型）
Remote.renderDirectoryList = function (directories, container) {
  let html = "";
  directories.forEach((dir) => {
    html += `
      <div class="process-item">
        <div class="process-header">
          <span class="process-name" title="${dir.path}">${dir.path.split('/').pop()}</span>
          <span class="process-cpu">${dir.size}</span>
        </div>
        <div class="process-details">
          <span class="process-pid">${dir.path}</span>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
};

// 渲染进程列表
Remote.renderProcessList = function (processes, container, isChild = false) {
  // 检查是否是关键系统进程（不可终止）
  const isCriticalProcess = (proc) => {
    const command = proc.command.toLowerCase();
    const name = proc.name.toLowerCase();

    // 关键进程列表
    return (
      command.includes("magicmirror") ||   // MagicMirror 主进程
      name === "electron" ||                // Electron 主进程
      name === "labwc" ||                   // Wayland 合成器
      name === "xwayland" ||                // X 服务器
      name === "pm2" ||                     // PM2 进程管理器
      command.includes("pm2") ||            // PM2 相关进程
      name === "pipewire" ||                // 音频服务
      name === "systemd" ||                 // 系统守护进程
      command.includes("/usr/lib/systemd") // systemd 相关服务
    );
  };

  let html = "";
  processes.forEach((proc) => {
    const hasChildren = proc.children && proc.children.length > 0;
    const childClass = isChild ? "child-process" : "";
    const hasChildrenClass = hasChildren ? "has-children" : "";
    const canKill = !hasChildren && !isCriticalProcess(proc);

    html += `
      <div class="process-item ${childClass} ${hasChildrenClass}" data-pid="${proc.pid}" data-has-children="${hasChildren}">
        <div class="process-header">
          ${hasChildren ?
            `<div class="process-name-with-arrow">
              <span class="fa fa-angle-right" aria-hidden="true"></span>
              <span class="process-name" title="${proc.command}">${proc.name}</span>
            </div>` :
            `<span class="process-name" title="${proc.command}">${proc.name}</span>`
          }
          <span class="process-cpu">${proc.cpu}%${proc.cpuRaw ? ` (${proc.cpuRaw}%)` : ''}</span>
          ${canKill ? `<span class="process-kill-btn" data-pid="${proc.pid}">✕</span>` : ""}
        </div>
        <div class="process-details">
          <span class="process-pid">PID: ${proc.pid}</span>
          <span class="process-memory">内存: ${proc.memory}</span>
        </div>
        ${proc.mmModule ? `<div class="process-mm-module">模块: ${proc.mmModule}</div>` : ""}
        ${hasChildren ? `<div class="process-children" data-pid="${proc.pid}" style="display:none;"></div>` : ""}
      </div>
    `;
  });
  container.innerHTML = html;

  // 绑定展开子进程事件
  container.querySelectorAll(".process-item.has-children").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("process-kill-btn")) return;
      const pid = item.getAttribute("data-pid");
      const childrenContainer = item.querySelector(".process-children");
      const arrow = item.querySelector(".fa-angle-right");

      if (childrenContainer.style.display === "none") {
        // 展开：加载子进程
        Remote.loadChildProcesses(pid, childrenContainer, arrow);
      } else {
        // 收起
        childrenContainer.style.display = "none";
        arrow.style.transform = "rotate(0deg)";
      }
    });
  });

  // 绑定杀进程事件
  container.querySelectorAll(".process-kill-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pid = btn.getAttribute("data-pid");
      Remote.killProcess(pid);
    });
  });
};

// 加载子进程
Remote.loadChildProcesses = function (ppid, container, arrow) {
  container.innerHTML = '<div class="loading">加载中...</div>';
  container.style.display = "block";
  arrow.style.transform = "rotate(90deg)";

  fetch(`/child-processes?ppid=${ppid}`)
    .then((response) => response.json())
    .then((data) => {
      if (data.processes && data.processes.length > 0) {
        Remote.renderProcessList(data.processes, container, true);
      } else {
        container.innerHTML = '<div class="loading" style="font-size:0.8em;color:#666;">无子进程</div>';
      }
    })
    .catch((error) => {
      console.error("获取子进程失败:", error);
      container.innerHTML = '<div class="loading">加载失败</div>';
    });
};

// 杀进程
Remote.killProcess = function (pid) {
  if (!confirm(`确定要终止进程 ${pid} 吗？`)) {
    return;
  }

  fetch(`/kill-process?pid=${pid}`, {method: "POST"})
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        alert(`进程 ${pid} 已终止`);
        // 重新加载当前详情
        const currentType = document.getElementById("system-detail-title").textContent;
        const typeMap = {
          "CPU 占用进程 TOP 5": "cpu",
          "内存占用进程 TOP 5": "memory",
          "系统运行进程": "uptime",
          "存储占用详情": "storage"
        };
        Remote.loadSystemDetail(typeMap[currentType] || "cpu");
      } else {
        alert(`终止进程失败: ${data.error || "未知错误"}`);
      }
    })
    .catch((error) => {
      console.error("终止进程失败:", error);
      alert("终止进程失败");
    });
};

// 清理垃圾文件
Remote.cleanupTrash = function () {
  if (!confirm("确定要清理垃圾文件吗？\n将清理以下内容：\n- Core dump 文件\n- macOS 临时文件 (._*)\n- .DS_Store 文件")) {
    return;
  }

  const cleanupBtn = document.getElementById("cleanup-trash-btn");
  if (cleanupBtn) {
    cleanupBtn.disabled = true;
    cleanupBtn.querySelector(".cleanup-text").textContent = "清理中...";
  }

  fetch("/cleanup-trash", {method: "POST"})
    .then((response) => response.json())
    .then((data) => {
      if (cleanupBtn) {
        cleanupBtn.disabled = false;
        cleanupBtn.querySelector(".cleanup-text").textContent = "清理垃圾";
      }

      if (data.success) {
        const cleaned = data.cleaned;
        const message = `清理完成！\n\nCore dump: ${cleaned.coreDump} 个\nmacOS 临时文件: ${cleaned.macTemp} 个\n.DS_Store: ${cleaned.dsStore} 个\n总大小: ${cleaned.totalSize}`;
        alert(message);

        // 重新加载存储详情
        Remote.loadSystemDetail("storage");
      } else {
        alert(`清理失败: ${data.error || "未知错误"}`);
      }
    })
    .catch((error) => {
      console.error("清理垃圾失败:", error);
      alert("清理垃圾失败");

      if (cleanupBtn) {
        cleanupBtn.disabled = false;
        cleanupBtn.querySelector(".cleanup-text").textContent = "清理垃圾";
      }
    });
};

// 初始化系统详情面板
Remote.initSystemDetailPanel();

// 系统信息更新函数
Remote.updateSystemInfo = function () {
  fetch("/system-info")
    .then((response) => response.json())
    .then((data) => {
      // 只在数据变化时更新 DOM，避免不必要的重绘
      const cpuElem = document.getElementById("cpu-usage");
      const memElem = document.getElementById("memory-usage");
      const uptimeElem = document.getElementById("uptime");
      const storageElem = document.getElementById("storage-usage");

      const newCpu = data.cpuUsage || "N/A";
      const newMem = data.memoryUsage || "N/A";
      const newUptime = data.uptime || "N/A";
      const newStorage = data.storageUsage || "N/A";

      if (cpuElem.textContent !== newCpu) cpuElem.textContent = newCpu;
      if (memElem.textContent !== newMem) memElem.textContent = newMem;
      if (uptimeElem.textContent !== newUptime) uptimeElem.textContent = newUptime;
      if (storageElem.textContent !== newStorage) storageElem.textContent = newStorage;
    })
    .catch((error) => {
      console.error("获取系统信息失败:", error);
    });
};

// 初始加载系统信息
Remote.updateSystemInfo();

// 每5秒更新一次系统信息
setInterval(() => {
  Remote.updateSystemInfo();
}, 5000);

if (window.location.hash) {
  Remote.showMenu(window.location.hash.substring(1));
} else {
  Remote.showMenu("main-menu");
}

window.onhashchange = function () {
  if (Remote.skipHashChange) {
    Remote.skipHashChange = false;
    return;
  }
  if (window.location.hash) {
    Remote.showMenu(window.location.hash.substring(1));
  } else {
    Remote.showMenu("main-menu");
  }
};

// loading successful, remove error message
const loadError = document.getElementById("load-error");
loadError.parentNode.removeChild(loadError);
