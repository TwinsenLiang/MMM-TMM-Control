/* global Module */

/*
 * MagicMirror²
 * Module: Remote Control
 *
 * By Joseph Bethge
 * MIT Licensed.
 */

const Log = require("logger");
const NodeHelper = require("node_helper");
const {exec} = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const url = require("node:url");
const util = require("node:util");
const simpleGit = require("simple-git");

const defaultModules = require(path.resolve(`${__dirname}/../../modules/default/defaultmodules.js`));
const {capitalizeFirst, formatName, includes} = require("./lib/utils.js");
const {cleanConfig} = require("./lib/configUtils.js");

// eslint-disable-next-line no-global-assign
Module = {
  configDefaults: {},
  notificationHandler: {},
  register (name, moduleDefinition) {
    Module.configDefaults[name] = moduleDefinition.defaults;

    /* API EXTENSION - Added v2.0.0 */
    Module.notificationHandler[name] = "notificationReceived" in moduleDefinition
      ? moduleDefinition.notificationReceived.toString()
      : "";
  }
};

module.exports = NodeHelper.create({
  // Subclass start method.
  start () {
    const self = this;

    this.initialized = false;
    Log.log(`Starting node helper for: ${self.name}`);

    // load fall back translation
    self.loadTranslation("en");
    // Note: zh-cn will be loaded in combineConfig() based on config.language

    this.configOnHd = {};
    this.configData = {};

    this.waiting = [];

    this.template = "";
    this.modulesAvailable = [];
    this.modulesInstalled = [];

    this.delayedQueryTimers = {};

    // Initialize monitor status (for black overlay control)
    this.monitorStatus = "on";

    // Initialize window minimized status (Electron isMinimized() is unreliable on RPi)
    this.windowMinimized = false;

    fs.readFile(path.resolve(`${__dirname}/remote.html`), (err, data) => {
      self.template = data.toString();
    });

    this.combineConfig();
    this.updateModuleList();
    this.createRoutes();

    /* API EXTENSION - Added v2.0.0 */
    this.externalApiRoutes = {};
    this.moduleApiMenu = {};
  },

  stop () {
    // Clear all timeouts for clean shutdown
    Object.keys(this.delayedQueryTimers).forEach((t) => {
      clearTimeout(this.delayedQueryTimers[t]);
    });
  },

  onModulesLoaded () {

    /* CALLED AFTER MODULES AND CONFIG DATA ARE LOADED */
    /* API EXTENSION - Added v2.0.0 */
    this.createApiRoutes();

    this.loadTimers();
  },

  loadTimers () {
    const delay = 24 * 3600;

    const self = this;

    clearTimeout(this.delayedQueryTimers.update);
    this.delayedQueryTimers.update = setTimeout(() => {
      self.updateModuleList();
      self.loadTimers();
    }, delay * 1000);
  },

  combineConfig () {
    // function copied from MagicMirrorOrg (MIT)
    const defaults = require(`${__dirname}/../../js/defaults.js`);
    const configPath = this.getConfigPath();
    this.thisConfig = {};
    try {
      fs.accessSync(configPath, fs.constants.F_OK);
      const c = require(configPath);
      const config = {...defaults, ...c};
      this.configOnHd = config;
      // Get the configuration for this module.
      if ("modules" in this.configOnHd) {
        const thisModule = this.configOnHd.modules.find((m) => m.module === "MMM-TMM-Control");
        if (thisModule && "config" in thisModule) {
          this.thisConfig = thisModule.config;
        }
      }
    } catch (error) {
      if (error.code == "ENOENT") {
        Log.error("[MMM-TMM-Control] Could not find config file. Please create one. Starting with default configuration.");
        this.configOnHd = defaults;
      } else if (error instanceof ReferenceError || error instanceof SyntaxError) {
        Log.error("[MMM-TMM-Control] Could not validate config file. Please correct syntax errors. Starting with default configuration.");
        this.configOnHd = defaults;
      } else {
        Log.error(`[MMM-TMM-Control] Could not load config file. Starting with default configuration. Error found: ${error}`);
        this.configOnHd = defaults;
      }
    }

    this.loadTranslation(this.configOnHd.language);
  },

  getConfigPath () {
    let configPath = path.resolve(`${__dirname}/../../config/config.js`);
    if (typeof global.configuration_file !== "undefined") {
      configPath = path.resolve(`${__dirname}/../../${global.configuration_file}`);
    }
    return configPath;
  },

  createRoutes () {
    const self = this;

    this.expressApp.get("/remote.html", (req, res) => {
      if (self.template === "") {
        res.sendStatus(503);
      } else {
        res.contentType("text/html");
        res.set("Content-Security-Policy", "frame-ancestors http://*:*");
        const transformedData = self.fillTemplates(self.template);
        res.send(transformedData);
      }
    });

    this.expressApp.get("/get", (req, res) => {
      const {query} = url.parse(req.url, true);

      self.answerGet(query, res);
    });
    this.expressApp.post("/post", (req, res) => {
      const {query} = url.parse(req.url, true);

      self.answerPost(query, req, res);
    });

    this.expressApp.get("/config-help.html", (req, res) => {
      const {query} = url.parse(req.url, true);

      self.answerConfigHelp(query, res);
    });

    this.expressApp.get("/remote", (req, res) => {
      const {query} = url.parse(req.url, true);

      if (query.action && ["COMMAND"].indexOf(query.action) === -1) {
        const result = self.executeQuery(query, res);
        if (result === true) {
          return;
        }
      }
      res.send({"status": "error", "reason": "unknown_command", "info": `original input: ${JSON.stringify(query)}`});
    });

    this.expressApp.get("/system-info", (req, res) => {
      self.getSystemInfo(res);
    });

    this.expressApp.get("/system-detail", (req, res) => {
      const {query} = url.parse(req.url, true);
      self.getSystemDetail(query.type || "cpu", res);
    });

    this.expressApp.get("/child-processes", (req, res) => {
      const {query} = url.parse(req.url, true);
      self.getChildProcesses(query.ppid, res);
    });

    this.expressApp.post("/kill-process", (req, res) => {
      const {query} = url.parse(req.url, true);
      self.killProcess(query.pid, res);
    });

    // 清理垃圾文件
    this.expressApp.post("/cleanup-trash", (req, res) => {
      self.cleanupTrash(res);
    });
  },

  capitalizeFirst (string) { return capitalizeFirst(string); },

  formatName (string) { return formatName(string); },

  getSystemInfo (res) {
    const info = {};

    // CPU使用率
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    cpus.forEach((cpu) => {
      for (let type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = ((1 - idle / total) * 100).toFixed(1);
    info.cpuUsage = usage + "%";

    // 内存使用率
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsage = ((usedMem / totalMem) * 100).toFixed(1);
    info.memoryUsage = memoryUsage + "%";

    // 系统运行时间
    const uptime = os.uptime();
    const days = Math.floor(uptime / (3600 * 24));
    const hours = Math.floor((uptime % (3600 * 24)) / 3600);
    info.uptime = days + " 天 " + hours + " 小时";

    // 存储空间使用率 - 使用df命令获取
    exec("df -h / | tail -1 | awk '{print $5}'", (error, stdout) => {
      if (!error && stdout) {
        info.storageUsage = stdout.trim();
      } else {
        info.storageUsage = "N/A";
      }

      if (res) {
        res.json(info);
      }
    });
  },

  getSystemDetail (type, res) {
    const self = this;

    // 存储类型：显示占用空间最大的目录
    if (type === "storage") {
      // 获取 MagicMirror 存储占用：主程序 + 各个模块
      const mmDir = "/home/mm/MagicMirror";

      // 1. 计算 MagicMirror 主程序大小（排除 modules 目录）
      const mainCmd = `du -sh --exclude=modules ${mmDir} 2>/dev/null | awk '{print $1}'`;

      // 2. 获取每个模块的大小
      const modulesCmd = `du -sh ${mmDir}/modules/* 2>/dev/null | sort -hr`;

      exec(mainCmd, (mainError, mainStdout) => {
        const mainSize = mainError ? "N/A" : mainStdout.trim();

        exec(modulesCmd, (modulesError, modulesStdout) => {
          const directories = [];

          // 添加主程序
          directories.push({
            size: mainSize,
            path: `${mmDir} (主程序，不含模块)`,
            isMain: true
          });

          // 添加各个模块
          if (!modulesError && modulesStdout) {
            const lines = modulesStdout.trim().split("\n");
            lines.forEach((line) => {
              const parts = line.split("\t");
              if (parts.length >= 2) {
                const moduleName = parts[1].split("/").pop();
                directories.push({
                  size: parts[0],
                  path: moduleName,
                  isModule: true
                });
              }
            });
          }

          res.json({directories});
        });
      });
      return;
    }

    // 获取 CPU 核心数和总内存
    const cpuCount = os.cpus().length; // CPU 核心数
    const totalMem = os.totalmem(); // 总内存

    // CPU/内存：混合数据源
    // 1. 先获取 PM2 管理的服务（有历史监控数据）
    // 2. 再获取系统进程（瞬时值）
    exec("pm2 jlist", (error, stdout) => {
      let pm2Processes = [];

      if (!error) {
        try {
          const pm2Data = JSON.parse(stdout);
          const totalMem = os.totalmem(); // 获取系统总内存

          pm2Processes = pm2Data
            .filter(proc => proc.pm2_env.status === "online")
            .map(proc => {
              const monit = proc.monit || {};
              const cpuRaw = monit.cpu || 0; // PM2 的 CPU（可以超过100%）
              const memBytes = monit.memory || 0;
              const memRaw = (memBytes / totalMem) * 100; // 占总内存的百分比

              // 计算占总核数的比例
              const cpuNormalized = cpuRaw / cpuCount;

              return {
                pid: proc.pid.toString(),
                cpu: cpuNormalized.toFixed(1), // 占总核数的百分比
                cpuRaw: cpuRaw.toFixed(1), // 原始值（括号内显示）
                memory: memRaw.toFixed(1) + "%",
                name: proc.name,
                command: proc.pm2_env.pm_exec_path || proc.name,
                mmModule: proc.name.startsWith("MMM-") ? proc.name : null,
                isPM2: true
              };
            });
        } catch (e) {
          Log.error("[MMM-TMM-Control] 解析 PM2 数据失败:", e);
        }
      }

      // 获取系统进程
      let sortBy = "--sort=-%cpu";
      if (type === "memory") {
        sortBy = "--sort=-%mem";
      }

      const cmd = `ps aux ${sortBy} | grep -v 'ps aux' | grep -v grep | grep -v 'USER.*PID' | head -10`;

      exec(cmd, (error, stdout) => {
        if (error) {
          Log.error("[MMM-TMM-Control] 获取进程信息失败:", error);
          res.json({processes: pm2Processes});
          return;
        }

        const lines = stdout.trim().split("\n");
        const systemProcesses = [];
        const magicMirrorElectrons = []; // 收集 MagicMirror 的 Electron 子进程

        lines.forEach((line) => {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 11) {
            const pid = parts[1];
            const cpu = parseFloat(parts[2]).toFixed(1);
            const mem = parseFloat(parts[3]).toFixed(1);
            const command = parts.slice(10).join(" ");

            // 跳过 PM2 已经包含的进程
            if (pm2Processes.some(p => p.pid === pid)) {
              return;
            }

            const cpuRaw = parseFloat(cpu);
            const memRaw = parseFloat(mem);

            // 如果是 MagicMirror 的 Electron 进程，收集起来合并
            if (command.includes("/MagicMirror/node_modules/electron")) {
              magicMirrorElectrons.push({
                pid,
                cpu: cpuRaw,
                mem: memRaw,
                command
              });
              return;
            }

            // 检查是否是相关进程（MagicMirror + 重要系统服务）
            const isMagicMirrorRelated =
              command.includes("MMM-") ||
              command.includes("/MagicMirror/") ||
              command.includes("node_modules") && command.includes("MagicMirror");

            // 重要的系统进程（对理解资源使用有帮助）
            const isImportantSystemProcess =
              command.includes("pm2") ||           // PM2 进程管理器
              command.includes("node") ||          // Node.js 进程
              command.includes("electron") ||      // Electron 进程
              command.includes("labwc") ||         // Wayland 合成器
              command.includes("Xwayland") ||      // X 服务器
              command.includes("pipewire") ||      // 音频服务
              command.includes("chromium") ||      // 浏览器
              command.includes("python") ||        // Python 进程（可能是模块后端）
              command.includes("nginx") ||         // Web 服务器
              command.includes("apache");          // Web 服务器

            // 如果既不是 MagicMirror 相关也不是重要系统进程，跳过
            if (!isMagicMirrorRelated && !isImportantSystemProcess) {
              return;
            }

            // 提取进程名称
            let name = command.split(" ")[0];
            if (name.includes("/")) {
              name = name.split("/").pop();
            }

            // 尝试关联到 MagicMirror 模块
            let mmModule = null;
            if (command.includes("MMM-")) {
              const match = command.match(/MMM-[A-Za-z0-9_-]+/);
              if (match) {
                mmModule = match[0];
              }
            }

            // 计算占总核数的比例
            const cpuNormalized = cpuRaw / cpuCount;

            systemProcesses.push({
              pid,
              cpu: cpuNormalized.toFixed(1),
              cpuRaw: cpuRaw.toFixed(1),
              memory: memRaw.toFixed(1) + "%",
              name,
              command,
              mmModule,
              isPM2: false
            });
          }
        });

        // 合并 MagicMirror 的 Electron 进程
        if (magicMirrorElectrons.length > 0) {
          const totalCpuRaw = magicMirrorElectrons.reduce((sum, p) => sum + p.cpu, 0);
          const totalMem = magicMirrorElectrons.reduce((sum, p) => sum + p.mem, 0);
          const totalCpuNormalized = totalCpuRaw / cpuCount;
          const mainElectron = magicMirrorElectrons[0];

          systemProcesses.push({
            pid: mainElectron.pid,
            cpu: totalCpuNormalized.toFixed(1),
            cpuRaw: totalCpuRaw.toFixed(1),
            memory: totalMem.toFixed(1) + "%",
            name: "MagicMirror (Electron)",
            command: "MagicMirror Electron 进程组 (" + magicMirrorElectrons.length + " 个子进程)",
            mmModule: null,
            isPM2: false,
            children: [] // 标记为有子进程，但不实际展开
          });
        }

        // 合并 PM2 进程和系统进程
        let allProcesses = [...pm2Processes, ...systemProcesses];

        // 根据类型排序
        if (type === "memory") {
          allProcesses.sort((a, b) => parseFloat(b.memory) - parseFloat(a.memory));
        } else {
          allProcesses.sort((a, b) => parseFloat(b.cpu) - parseFloat(a.cpu));
        }

        // 取 TOP 5
        const top5 = allProcesses.slice(0, 5);

        // 检查这些进程是否有子进程
        Promise.all(
          top5.map((proc) => {
            return new Promise((resolve) => {
              exec(`ps --ppid ${proc.pid} --no-headers | wc -l`, (err, stdout) => {
                const childCount = err ? 0 : parseInt(stdout.trim());
                proc.children = childCount > 0 ? [] : undefined;
                resolve();
              });
            });
          })
        ).then(() => {
          res.json({processes: top5});
        });
      });
    });
  },

  getChildProcesses (ppid, res) {
    if (!ppid) {
      res.json({processes: []});
      return;
    }

    exec(`ps --ppid ${ppid} -o pid,%cpu,%mem,command --no-headers`, (error, stdout) => {
      if (error) {
        Log.error("[MMM-TMM-Control] 获取子进程失败:", error);
        res.json({processes: []});
        return;
      }

      const lines = stdout.trim().split("\n");
      const processes = [];

      lines.forEach((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          const pid = parts[0];
          const cpu = parseFloat(parts[1]).toFixed(1);
          const mem = parseFloat(parts[2]).toFixed(1);
          const command = parts.slice(3).join(" ");

          let name = command.split(" ")[0];
          if (name.includes("/")) {
            name = name.split("/").pop();
          }

          let mmModule = null;
          if (command.includes("MMM-")) {
            const match = command.match(/MMM-[A-Za-z0-9_-]+/);
            if (match) {
              mmModule = match[0];
            }
          }

          processes.push({
            pid,
            cpu,
            memory: mem + "%",
            name,
            command,
            mmModule
          });
        }
      });

      res.json({processes});
    });
  },

  killProcess (pid, res) {
    if (!pid) {
      res.json({success: false, error: "未提供 PID"});
      return;
    }

    exec(`kill ${pid}`, (error, stdout, stderr) => {
      if (error) {
        Log.error(`[MMM-TMM-Control] 终止进程 ${pid} 失败:`, error);
        res.json({success: false, error: stderr || error.message});
        return;
      }

      Log.log(`[MMM-TMM-Control] 成功终止进程 ${pid}`);
      res.json({success: true});
    });
  },

  // 清理垃圾文件
  cleanupTrash (res) {
    const path = require("path");
    // 修改：调用 MagicMirror 根目录的 service.sh clean 命令
    const scriptPath = path.join(__dirname, "../../service.sh");

    Log.log("[MMM-TMM-Control] 开始清理垃圾文件...");

    exec(`bash ${scriptPath} clean`, (error, stdout, stderr) => {
      if (error) {
        Log.error("[MMM-TMM-Control] 清理垃圾失败:", error);
        res.json({success: false, error: stderr || error.message});
        return;
      }

      try {
        // 从输出中提取 JSON（service.sh 会输出额外的信息）
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          Log.log("[MMM-TMM-Control] 垃圾清理完成:", result);
          res.json(result);
        } else {
          throw new Error("未找到JSON输出");
        }
      } catch (parseError) {
        Log.error("[MMM-TMM-Control] 解析清理结果失败:", parseError);
        Log.log("[MMM-TMM-Control] 原始输出:", stdout);
        res.json({success: false, error: "解析清理结果失败"});
      }
    });
  },

  updateModuleList (force) {
    const downloadModules = require("./scripts/download_modules");
    downloadModules({
      force,
      callback: (result) => {
        if (result && result.startsWith("ERROR")) { Log.error("[MMM-TMM-Control]", result); }
        this.readModuleData();
      }
    });
  },

  readModuleData () {
    const self = this;

    fs.readFile(path.resolve(`${__dirname}/modules.json`), (err, data) => {
      self.modulesAvailable = JSON.parse(data.toString());

      for (let i = 0; i < self.modulesAvailable.length; i++) {
        self.modulesAvailable[i].name = self.formatName(self.modulesAvailable[i].longname);
        self.modulesAvailable[i].isDefaultModule = false;
      }

      for (let i = 0; i < defaultModules.length; i++) {
        self.modulesAvailable.push({
          longname: defaultModules[i],
          name: self.capitalizeFirst(defaultModules[i]),
          isDefaultModule: true,
          installed: true,
          author: "MagicMirrorOrg",
          desc: "",
          id: "MagicMirrorOrg/MagicMirror",
          url: "https://docs.magicmirror.builders/modules/introduction.html"
        });
        const module = self.modulesAvailable[self.modulesAvailable.length - 1];
        const modulePath = `modules/default/${defaultModules[i]}`;
        self.loadModuleDefaultConfig(module, modulePath, i === defaultModules.length - 1);
      }

      // now check for installed modules
      fs.readdir(path.resolve(`${__dirname}/..`), (err, files) => {
        const installedModules = files.filter((f) => [
          "node_modules",
          "default",
          "README.md"
        ].indexOf(f) === -1);
        installedModules.forEach((dir, i) => {
          self.addModule(dir, i === installedModules.length - 1);
        });
      });
    });
  },

  getModuleDir () {
    return this.configOnHd.foreignModulesDir
      ? this.configOnHd.foreignModulesDir
      : this.configOnHd.paths
        ? this.configOnHd.paths.modules
        : "modules";
  },

  addModule (folderName, lastOne) {
    const self = this;

    const modulePath = `${this.getModuleDir()}/${folderName}`;
    fs.stat(modulePath, (err, stats) => {
      if (stats.isDirectory()) {
        self.modulesInstalled.push(folderName);

        // 尝试获取 Git 远程 URL 来精确匹配
        try {
          fs.statSync(path.join(modulePath, ".git"));
          const sg = simpleGit(modulePath);
          sg.getRemotes(true, (error, remotes) => {
            let moduleUrl = "";
            if (!error && remotes && remotes.length > 0) {
              let baseUrl = remotes[0].refs.fetch;
              // 标准化 URL
              baseUrl = baseUrl.replace(".git", "").replace("github.com:", "github.com/");
              moduleUrl = baseUrl.replace("git@", "https://");
            }

            // 查找匹配的模块
            let isInList = false;
            let currentModule;
            for (let i = 0; i < self.modulesAvailable.length; i++) {
              if (self.modulesAvailable[i].longname === folderName) {
                // 如果有 URL，精确匹配；否则只匹配名称
                if (moduleUrl && self.modulesAvailable[i].url === moduleUrl) {
                  isInList = true;
                  self.modulesAvailable[i].installed = true;
                  currentModule = self.modulesAvailable[i];
                  break;
                } else if (!moduleUrl && !self.modulesAvailable[i].installed) {
                  // 没有 URL 时，取第一个未安装的同名模块
                  isInList = true;
                  self.modulesAvailable[i].installed = true;
                  currentModule = self.modulesAvailable[i];
                  break;
                }
              }
            }

            if (!isInList) {
              const newModule = {
                longname: folderName,
                name: self.formatName(folderName),
                isDefaultModule: false,
                installed: true,
                author: "unknown",
                desc: "",
                id: `local/${folderName}`,
                url: moduleUrl
              };
              self.modulesAvailable.push(newModule);
              currentModule = newModule;
            }

            // 检查可用更新
            const sg2 = simpleGit(modulePath);
            sg2.fetch().status((err, data) => {
              if (!err && data.behind > 0) {
                currentModule.updateAvailable = true;
              }
            });

            self.loadModuleDefaultConfig(currentModule, modulePath, lastOne);
          });
        } catch (error) {
          // 没有 .git 目录，按原逻辑处理
          let isInList = false;
          let currentModule;
          for (let i = 0; i < self.modulesAvailable.length; i++) {
            if (self.modulesAvailable[i].longname === folderName && !self.modulesAvailable[i].installed) {
              isInList = true;
              self.modulesAvailable[i].installed = true;
              currentModule = self.modulesAvailable[i];
              break;
            }
          }
          if (!isInList) {
            const newModule = {
              longname: folderName,
              name: self.formatName(folderName),
              isDefaultModule: false,
              installed: true,
              author: "unknown",
              desc: "",
              id: `local/${folderName}`,
              url: ""
            };
            self.modulesAvailable.push(newModule);
            currentModule = newModule;
          }
          self.loadModuleDefaultConfig(currentModule, modulePath, lastOne);
          return;
        }
      }
    });
  },

  loadModuleDefaultConfig (module, modulePath, lastOne) {
    const filename = path.resolve(`${modulePath}/${module.longname}.js`);

    try {
      fs.accessSync(filename, fs.constants.F_OK);

      /* Defaults are stored when Module.register is called during require(filename); */
      require(filename);
    } catch (e) {
      if (e instanceof ReferenceError) {
        Log.log(`[MMM-TMM-Control] Could not get defaults for ${module.longname}. See #335.`);
      } else if (e.code == "ENOENT") {
        Log.error(`[MMM-TMM-Control] Could not find main module js file for ${module.longname}`);
      } else if (e instanceof SyntaxError) {
        Log.error(`[MMM-TMM-Control] Could not validate main module js file for ${module.longname}`);
        Log.error(e);
      } else {
        Log.error(`[MMM-TMM-Control] Could not load main module js file for ${module.longname}. Error found: ${e}`);
      }
    }
    if (lastOne) { this.onModulesLoaded(); }
  },

  answerConfigHelp (query, res) {
    if (defaultModules.indexOf(query.module) !== -1) {
      // default module
      const dir = path.resolve(`${__dirname}/..`);
      const git = simpleGit(dir);
      git.revparse(["HEAD"], (error, result) => {
        if (error) {
          Log.error("[MMM-TMM-Control]", error);
        }
        res.writeHead(302, {"Location": `https://github.com/MagicMirrorOrg/MagicMirror/tree/${result.trim()}/modules/default/${query.module}`});
        res.end();
      });
      return;
    }
    const modulePath = `${this.getModuleDir()}/${query.module}`;
    const git = simpleGit(modulePath);
    git.getRemotes(true, (error, result) => {
      if (error) {
        Log.error("[MMM-TMM-Control]", error);
      }
      let baseUrl = result[0].refs.fetch;
      // replacements
      baseUrl = baseUrl.replace(".git", "").replace("github.com:", "github.com/");
      // if cloned with ssh
      baseUrl = baseUrl.replace("git@", "https://");
      git.revparse(["HEAD"], (error, result) => {
        if (error) {
          Log.error("[MMM-TMM-Control]", error);
        }
        res.writeHead(302, {"Location": `${baseUrl}/tree/${result.trim()}`});
        res.end();
      });
    });
  },

  getConfig () {
    const config = this.configOnHd;
    for (let i = 0; i < config.modules.length; i++) {
      const current = config.modules[i];
      const moduleDefaultsFromRequire = Module.configDefaults[current.module];
      // We need moduleDataFromBrowser for bundled modules like MMM-RAIN-MAP. See #331.
      const moduleDataFromBrowser = this.configData.moduleData?.find((item) => item.name === current.module);

      const moduleConfig = moduleDefaultsFromRequire || moduleDataFromBrowser?.config || {};

      if (!current.config) current.config = {};
      for (const key in moduleConfig) {
        if (!(key in current.config)) {
          current.config[key] = moduleConfig[key];
        }
      }
    }
    return config;
  },

  removeDefaultValues (config) {
    // Reload default config (avoid module cache if updated during runtime)
    delete require.cache[require.resolve(`${__dirname}/../../js/defaults.js`)];
    const defaultConfig = require(`${__dirname}/../../js/defaults.js`);
    const moduleDefaultsMap = Module.configDefaults;
    const moduleDataFromBrowser = this.configData.moduleData || [];
    const cleaned = cleanConfig({
      config,
      defaultConfig,
      moduleDefaultsMap,
      moduleDataFromBrowser
    });
    cleaned.modules?.forEach((m) => Log.debug(m));
    return cleaned;
  },

  answerPost (query, req, res) {
    const self = this;

    if (query.data === "config") {
      const backupHistorySize = 5;
      const configPath = this.getConfigPath();

      let best = -1;
      let bestTime = null;
      for (let i = backupHistorySize - 1; i > 0; i--) {
        const backupPath = path.resolve(`config/config.js.backup${i}`);
        try {
          const stats = fs.statSync(backupPath);
          if (best === -1 || stats.mtime < bestTime) {
            best = i;
            bestTime = stats.mtime;
          }
        } catch (e) {
          if (e.code === "ENOENT") {
            // does not exist yet
            best = i;
            bestTime = "0000-00-00T00:00:00Z";
          }
        }
      }
      if (best === -1) {
        // can not backup, panic!
        Log.error("[MMM-TMM-Control] Backing up config failed, not saving!");
        self.sendResponse(res, new Error("Backing up config failed, not saving!"), {query});
        return;
      }
      const backupPath = path.resolve(`config/config.js.backup${best}`);

      const source = fs.createReadStream(configPath);
      const destination = fs.createWriteStream(backupPath);

      // back up last config
      source.pipe(destination, {end: false});
      source.on("end", () => {
        self.configOnHd = self.removeDefaultValues(req.body);

        const header = "/*************** AUTO GENERATED BY REMOTE CONTROL MODULE ***************/\n\nlet config = \n";
        const footer = "\n\n/*************** DO NOT EDIT THE LINE BELOW ***************/\nif (typeof module !== 'undefined') {module.exports = config;}\n";

        fs.writeFile(
          configPath, header + util.inspect(self.configOnHd, {
            showHidden: false,
            depth: null,
            maxArrayLength: null,
            compact: false
          }) + footer,
          (error) => {
            query.data = "config_update";
            if (error) {
              self.sendResponse(res, error, {query, backup: backupPath, data: self.configOnHd});
            }
            Log.info("MMM-TMM-Control saved new config!");
            Log.info(`Used backup: ${backupPath}`);
            self.sendResponse(res, undefined, {query, backup: backupPath, data: self.configOnHd});
          }
        );
      });
    }
  },

  answerGet (query, res) {
    const self = this;

    if (query.data === "moduleAvailable") {
      this.modulesAvailable.sort((a, b) => a.name.localeCompare(b.name));
      this.sendResponse(res, undefined, {query, data: this.modulesAvailable});
      return;
    }
    if (query.data === "moduleInstalled") {
      const filterInstalled = function (value) {
        return value.installed && !value.isDefaultModule;
      };
      const installed = self.modulesAvailable.filter(filterInstalled);
      installed.sort((a, b) => a.name.localeCompare(b.name));
      this.sendResponse(res, undefined, {query, data: installed});
      return;
    }
    if (query.data === "translations") {
      this.sendResponse(res, undefined, {query, data: this.translation});
      return;
    }
    if (query.data === "mmUpdateAvailable") {
      const self = this; // 保存 this 上下文
      // 检查 MMM-TMM-Control 模块自己的 Git 仓库
      const sg = simpleGit(__dirname);

      // 添加超时保护和响应标志
      let responded = false;
      const timeout = setTimeout(() => {
        if (!responded) {
          responded = true;
          console.error("[MMM-TMM-Control] Git fetch timeout, sending false");
          self.sendResponse(res, undefined, {query, result: false});
        }
      }, 10000); // 10秒超时

      sg.fetch().status((err, data) => {
        clearTimeout(timeout);
        if (responded) return; // 已经超时响应了，不再处理

        responded = true;
        if (!err) {
          if (data.behind > 0) {
            self.sendResponse(res, undefined, {query, result: true});
            return;
          }
        } else {
          console.error("[MMM-TMM-Control] Git status check error:", err);
        }
        self.sendResponse(res, undefined, {query, result: false});
      });
      return;
    }
    if (query.data === "config") {
      this.sendResponse(res, undefined, {query, data: this.getConfig()});
      return;
    }
    if (query.data === "classes") {
      const thisConfig = this.getConfig().modules.find((m) => m.module === "MMM-TMM-Control").config || {};
      this.sendResponse(res, undefined, {query, data: thisConfig.classes
        ? thisConfig.classes
        : {}});
      return;
    }
    if (query.data === "saves") {
      const backupHistorySize = 5;
      const times = [];

      for (let i = backupHistorySize - 1; i > 0; i--) {
        const backupPath = path.resolve(`config/config.js.backup${i}`);
        try {
          const stats = fs.statSync(backupPath);
          times.push(stats.mtime);
        } catch (error) {
          Log.debug(`Backup ${i} does not exist: ${error}.`);
          continue;
        }
      }
      this.sendResponse(res, undefined, {query, data: times.sort((a, b) => b - a)});
      return;
    }
    if (query.data === "defaultConfig") {
      if (!(query.module in Module.configDefaults)) {
        this.sendResponse(res, undefined, {query, data: {}});
      } else {
        this.sendResponse(res, undefined, {query, data: Module.configDefaults[query.module]});
      }
      return;
    }
    if (query.data === "modules") {
      if (!this.checkInitialized(res)) { return; }
      this.callAfterUpdate(() => {
        this.sendResponse(res, undefined, {query, data: self.configData.moduleData});
      });
      return;
    }
    if (query.data === "brightness") {
      if (!this.checkInitialized(res)) { return; }
      this.callAfterUpdate(() => {
        this.sendResponse(res, undefined, {query, result: self.configData.brightness});
      });
      return;
    }
    if (query.data === "temp") {
      if (!this.checkInitialized(res)) { return; }
      this.callAfterUpdate(() => {
        this.sendResponse(res, undefined, {query, result: self.configData.temp});
      });
      return;
    }
    if (query.data === "userPresence") {
      this.sendResponse(res, undefined, {query, result: this.userPresence});
      return;
    }
    // Unknown Command, Return Error
    this.sendResponse(res, "Unknown or Bad Command.", query);
  },

  callAfterUpdate (callback, timeout) {
    if (timeout === undefined) {
      timeout = 3000;
    }

    const waitObject = {
      finished: false,
      run () {
        if (this.finished) {
          return;
        }
        this.finished = true;
        this.callback();
      },
      callback
    };

    this.waiting.push(waitObject);
    this.sendSocketNotification("UPDATE");
    setTimeout(() => {
      waitObject.run();
    }, timeout);
  },

  delayedQuery (query, res) {
    if (query.did in this.delayedQueryTimers) {
      clearTimeout(this.delayedQueryTimers[query.did]);
      delete this.delayedQueryTimers[query.did];
    }
    if (!query.abort) {
      this.delayedQueryTimers[query.did] = setTimeout(() => {
        this.executeQuery(query.query);
        delete this.delayedQueryTimers[query.did];
      }, ("timeout" in query
        ? query.timeout
        : 10) * 1000);
    }
    this.sendResponse(res, undefined, query);
  },

  sendResponse (res, error, data) {
    let response = {success: true};
    let status = 200;
    let result = true;
    if (error) {
      Log.error("[MMM-TMM-Control]", error);
      response = {success: false, status: "error", reason: "unknown", info: error};
      status = 400;
      result = false;
    }
    if (data) {
      response = {...response, ...data};
    }
    if (res) {
      if ("isSocket" in res && res.isSocket) {
        this.sendSocketNotification("REMOTE_ACTION_RESULT", response);
      } else {
        res.status(status).json(response);
      }
    }
    return result;
  },

  monitorControl (action, opts, res) {
    // 使用前端黑色遮罩层实现显示器控制，不需要执行系统命令
    // 魔镜原理：屏幕黑色时，单面镜就变成普通镜子
    let status = this.monitorStatus || "on";

    Log.log(`[MMM-TMM-Control] monitorControl: action=${action}, current status=${status}`);

    switch (action) {
      case "MONITORSTATUS":
        this.sendResponse(res, undefined, {monitor: status});
        break;

      case "MONITORTOGGLE":
        const newAction = status === "on" ? "MONITOROFF" : "MONITORON";
        Log.log(`[MMM-TMM-Control] MONITORTOGGLE: current=${status}, switching to ${newAction}`);
        // 直接处理切换逻辑，不递归调用以避免重复发送响应
        if (newAction === "MONITORON") {
          Log.log(`[MMM-TMM-Control] MONITORON: setting status to "on" and sending MONITOR_ON notification`);
          this.monitorStatus = "on";
          this.sendSocketNotification("MONITOR_ON");
          this.sendResponse(res, undefined, {monitor: "on"});
          this.sendSocketNotification("USER_PRESENCE", true);
        } else {
          Log.log(`[MMM-TMM-Control] MONITOROFF: setting status to "off" and sending MONITOR_OFF notification`);
          this.monitorStatus = "off";
          this.sendSocketNotification("MONITOR_OFF");
          this.sendResponse(res, undefined, {monitor: "off"});
          this.sendSocketNotification("USER_PRESENCE", false);
        }
        break;

      case "MONITORON":
        Log.log(`[MMM-TMM-Control] MONITORON: setting status to "on" and sending MONITOR_ON notification`);
        this.monitorStatus = "on";
        this.sendSocketNotification("MONITOR_ON");
        this.sendResponse(res, undefined, {monitor: "on"});
        this.sendSocketNotification("USER_PRESENCE", true);
        break;

      case "MONITOROFF":
        Log.log(`[MMM-TMM-Control] MONITOROFF: setting status to "off" and sending MONITOR_OFF notification`);
        this.monitorStatus = "off";
        this.sendSocketNotification("MONITOR_OFF");
        this.sendResponse(res, undefined, {monitor: "off"});
        this.sendSocketNotification("USER_PRESENCE", false);
        break;
    }
  },

  shutdownControl (action, opts, res) {
    const shutdownCommand = this.thisConfig?.customCommand?.shutdownCommand || "sudo shutdown -h now";
    const rebootCommand = this.thisConfig?.customCommand?.rebootCommand || "sudo shutdown -r now";

    // 先发送响应，因为系统即将关机/重启
    if (action === "SHUTDOWN") {
      this.sendResponse(res, undefined, {action: "shutdown", info: "System shutting down...", status: "success"});
      // 延迟执行，确保响应已发送
      setTimeout(() => {
        exec(shutdownCommand, opts, (error, stdout, stderr) => {
          if (error) {
            Log.error(`[MMM-TMM-Control] Shutdown error:`, error);
          } else {
            Log.log(`[MMM-TMM-Control] Shutdown command executed`);
          }
        });
      }, 100);
    }

    if (action === "REBOOT") {
      this.sendResponse(res, undefined, {action: "reboot", info: "System rebooting...", status: "success"});
      // 延迟执行，确保响应已发送
      setTimeout(() => {
        exec(rebootCommand, opts, (error, stdout, stderr) => {
          if (error) {
            Log.error(`[MMM-TMM-Control] Reboot error:`, error);
          } else {
            Log.log(`[MMM-TMM-Control] Reboot command executed`);
          }
        });
      }, 100);
    }
  },

  executeQuery (query, res) {
    const self = this;
    const opts = {timeout: 15000};

    if (["SHUTDOWN", "REBOOT"].indexOf(query.action) !== -1) {
      this.shutdownControl(query.action, opts, res);
      return true;
    }
    if (query.action === "RESTART" || query.action === "STOP") {
      this.controlPm2(res, query);
      return true;
    }
    if (query.action === "COMMAND") {
      if (this.thisConfig.customCommand && this.thisConfig.customCommand[query.command]) {
        exec(this.thisConfig.customCommand[query.command], opts, (error, stdout, stderr) => {
          self.checkForExecError(error, stdout, stderr, res, {stdout});
        });
      } else {
        self.sendResponse(res, new Error("Command not found"), query);
      }
      return true;
    }
    if (query.action === "USER_PRESENCE") {
      this.sendSocketNotification("USER_PRESENCE", query.value);
      this.userPresence = query.value;
      this.sendResponse(res, undefined, query);
      return true;
    }
    if (["MONITORON", "MONITOROFF", "MONITORTOGGLE", "MONITORSTATUS"].indexOf(query.action) !== -1) {
      this.monitorControl(query.action, opts, res);
      return true;
    }
    if (query.action === "HIDE" || query.action === "SHOW" || query.action === "TOGGLE") {
      self.sendSocketNotification(query.action, query);
      self.sendResponse(res);
      return true;
    }
    if (query.action === "BRIGHTNESS") {
      self.sendResponse(res);
      self.sendSocketNotification(query.action, query.value);
      return true;
    }
    if (query.action === "TEMP") {
      self.sendResponse(res);
      self.sendSocketNotification(query.action, query.value);
      return true;
    }
    if (query.action === "SAVE") {
      self.sendResponse(res);
      self.callAfterUpdate(() => { self.saveDefaultSettings(); });
      return true;
    }
    if (query.action === "MODULE_DATA") {
      self.callAfterUpdate(() => {
        self.sendResponse(res, undefined, self.configData);
      });
      return true;
    }
    if (query.action === "INSTALL") {
      self.installModule(query.url, res, query);
      return true;
    }
    if (query.action === "REFRESH") {
      self.sendResponse(res);
      self.sendSocketNotification(query.action);
      return true;
    }
    if (query.action === "HIDE_ALERT") {
      self.sendResponse(res);
      self.sendSocketNotification(query.action);
      return true;
    }
    if (query.action === "SHOW_ALERT") {
      self.sendResponse(res);

      const type = query.type
        ? query.type
        : "alert";
      const title = query.title
        ? query.title
        : "Note";
      const message = query.message
        ? query.message
        : "Attention!";
      const timer = query.timer
        ? query.timer
        : 4;

      self.sendSocketNotification(query.action, {
        type,
        title,
        message,
        timer: timer * 1000
      });
      return true;
    }
    if (query.action === "UPDATE") {
      self.updateModule(decodeURI(query.module), res);
      return true;
    }
    if (query.action === "NOTIFICATION") {
      try {
        let payload = {}; // Assume empty JSON-object if no payload is provided
        if (typeof query.payload === "undefined") {
          payload = query.payload;
        } else if (typeof query.payload === "object") {
          payload = query.payload;
        } else if (typeof query.payload === "string") {
          if (query.payload.startsWith("{")) {
            payload = JSON.parse(query.payload);
          } else {
            payload = query.payload;
          }
        }
        this.sendSocketNotification(query.action, {"notification": query.notification, payload});
        this.sendResponse(res);
        return true;
      } catch (error) {

        /*
         * JSON parse errors are expected when users provide invalid input.
         * Only log as debug, not as error.
         */
        if (error instanceof SyntaxError) {
          Log.debug(`[MMM-TMM-Control] Invalid JSON payload: ${error.message}`);
        } else {
          Log.error("[MMM-TMM-Control]", error);
        }
        this.sendResponse(res, error, {reason: error.message});
        return true;
      }
    }
    if (query.action === "MANAGE_CLASSES") {
      if (!query.payload || !query.payload.classes || !this.thisConfig || !this.thisConfig.classes) { return; }
      const classes = [];
      switch (typeof query.payload.classes) {
        case "string": classes.push(this.thisConfig.classes[query.payload.classes]); break;
        case "object": query.payload.classes.forEach((t) => classes.push(this.thisConfig.classes[t]));
      }
      classes.forEach((cl) => {
        for (const act in cl) {
          if ([
            "SHOW",
            "HIDE",
            "TOGGLE"
          ].includes(act.toUpperCase())) {
            if (typeof cl[act] === "string") { this.sendSocketNotification(act.toUpperCase(), {module: cl[act]}); } else {
              cl[act].forEach((t) => {
                this.sendSocketNotification(act.toUpperCase(), {module: t});
              });
            }
          }
        }
      });
      this.sendResponse(res);
      return;
    }
    if ([
      "MINIMIZE",
      "TOGGLEMINIMIZE",
      "MINIMIZESTATUS",
      "TOGGLEFULLSCREEN",
      "DEVTOOLS"
    ].indexOf(query.action) !== -1) {
      try {
        const electron = require("electron").BrowserWindow;
        if (!electron) { throw "Could not get Electron window instance."; }
        const win = electron.getAllWindows()[0];
        switch (query.action) {
          case "MINIMIZE":
            win.minimize();
            this.sendResponse(res);
            break;
          case "TOGGLEMINIMIZE":
            Log.log(`[MMM-TMM-Control] TOGGLEMINIMIZE: current windowMinimized=${this.windowMinimized}`);
            if (this.windowMinimized) {
              // 窗口已最小化，恢复它
              Log.log(`[MMM-TMM-Control] Restoring window from minimized state`);
              win.restore();
              win.show();
              win.focus();
              this.windowMinimized = false;
              this.sendResponse(res, undefined, {minimized: false});
            } else {
              // 窗口未最小化，最小化它
              Log.log(`[MMM-TMM-Control] Minimizing window`);
              win.minimize();
              this.windowMinimized = true;
              this.sendResponse(res, undefined, {minimized: true});
            }
            break;
          case "MINIMIZESTATUS":
            this.sendResponse(res, undefined, {minimized: this.windowMinimized});
            break;
          case "TOGGLEFULLSCREEN":
            win.setFullScreen(!win.isFullScreen());
            this.sendResponse(res);
            break;
          case "DEVTOOLS":
            if (win.webContents.isDevToolsOpened()) {
              win.webContents.closeDevTools();
            } else {
              win.webContents.openDevTools();
            }
            this.sendResponse(res);
            break;
          default:
        }
      } catch (err) {
        this.sendResponse(res, err);
      }
      return;
    }
    if (query.action === "DELAYED") {

      /*
       * Expects a nested query object
       *   {
       *       action: "DELAYED",
       *       did: "SOME_UNIQUE_ID",
       *       timeout: 10000,  // Optional; Default 10000ms
       *       abort: false, // Optional; send to cancel
       *       query: {
       *           action: "SHOW_ALERT",
       *           title: "Delayed Alert!",
       *           message: "This is a delayed alert test."
       *       }
       *   }
       * Resending with same ID resets delay, unless abort:true
       */
      this.delayedQuery(query, res);
      return;
    }
    self.sendResponse(res, new Error(`Invalid Option: ${query.action}`));
    return false;
  },

  installModule (url, res, data) {
    const self = this;

    simpleGit(path.resolve(`${__dirname}/..`)).clone(url, path.basename(url), (error) => {
      if (error) {
        Log.error("[MMM-TMM-Control]", error);
        self.sendResponse(res, error);
      } else {
        const workDir = path.resolve(`${__dirname}/../${path.basename(url)}`);
        const packageJsonExists = fs.existsSync(`${workDir}/package.json`);
        if (packageJsonExists) {
          const packageJson = JSON.parse(fs.readFileSync(`${workDir}/package.json`, "utf8"));
          const installNecessary = packageJson.dependencies || packageJson.scripts?.preinstall || packageJson.scripts?.postinstall;
          if (installNecessary) {
            const packageLockExists = fs.existsSync(`${workDir}/package-lock.json`);
            const command = packageLockExists
              ? "npm ci --omit=dev"
              : "npm install --omit=dev";

            exec(command, {cwd: workDir, timeout: 120000}, (error, stdout, stderr) => {
              if (error) {
                Log.error("[MMM-TMM-Control]", error);
                self.sendResponse(res, error, {stdout, stderr, ...data});
              } else {
                // success part
                self.readModuleData();
                self.sendResponse(res, undefined, {stdout, ...data});
              }
            });
          }
        } else {
          self.readModuleData();
          self.sendResponse(res, undefined, {stdout: "Module installed.", ...data});
        }
      }
    });
  },

  updateModule (module, res) {
    Log.log(`UPDATE ${module || "MagicMirror"}`);

    const self = this;

    let path = `${__dirname}/../../`;
    let name = "MM";

    if (typeof module !== "undefined" && module !== "undefined") {
      if (self.modulesAvailable) {
        const modData = self.modulesAvailable.find((m) => m.longname === module);
        if (modData === undefined) {
          this.sendResponse(res, new Error("Unknown Module"), {info: module});
          return;
        }

        path = `${__dirname}/../${modData.longname}`;
        name = modData.name;
      }
    }

    Log.log(`[MMM-TMM-Control] path: ${path} name: ${name}`);

    const git = simpleGit(path);
    git.reset("hard").then(() => {
      // 清理 untracked files 和目录，避免阻止 pull
      git.clean('f', ['-d'], () => {
        git.pull(['--ff-only'], (error, result) => {
        if (error) {
          // 检查是否是 SSH 权限错误
          if (error.message && error.message.includes("Permission denied (publickey)")) {
            Log.log("[MMM-TMM-Control] SSH 权限错误，尝试转换为 HTTPS...");
            // 获取当前的远程 URL
            git.getRemotes(true, (err, remotes) => {
              if (err || !remotes || remotes.length === 0) {
                self.sendResponse(res, error, {reason: "git_error", message: "SSH 访问失败且无法获取远程仓库信息"});
                return;
              }
              const remote = remotes.find(r => r.name === "origin");
              if (!remote) {
                self.sendResponse(res, error, {reason: "git_error", message: "SSH 访问失败且找不到 origin 远程仓库"});
                return;
              }

              // 将 SSH URL 转换为 HTTPS
              let httpsUrl = remote.refs.fetch;
              if (httpsUrl.startsWith("git@github.com:")) {
                httpsUrl = httpsUrl.replace("git@github.com:", "https://github.com/");
              } else if (httpsUrl.startsWith("git@")) {
                // 处理其他 git@ 格式
                httpsUrl = httpsUrl.replace(/^git@([^:]+):/, "https://$1/");
              }

              Log.log(`[MMM-TMM-Control] 转换 URL: ${remote.refs.fetch} -> ${httpsUrl}`);

              // 设置新的远程 URL
              git.remote(["set-url", "origin", httpsUrl], (err) => {
                if (err) {
                  self.sendResponse(res, err, {reason: "git_error", message: "无法转换为 HTTPS URL"});
                  return;
                }

                // 重新尝试拉取
                git.pull(['--ff-only'], (error2, result2) => {
                  if (error2) {
                    // 如果还是认证错误，尝试清除凭证缓存并重试
                    if (error2.message.includes("could not read Username") || error2.message.includes("Authentication failed")) {
                      Log.log("[MMM-TMM-Control] 尝试不使用凭证拉取...");
                      // 使用 GIT_TERMINAL_PROMPT=0 禁用凭证提示，使用 --ff-only 避免分支分歧问题
                      exec(`cd "${path}" && GIT_TERMINAL_PROMPT=0 git pull --ff-only`, {timeout: 30000}, (error3, stdout, stderr) => {
                        if (error3) {
                          let errorMsg = "这是一个私有仓库，需要配置 GitHub 访问令牌";
                          if (stderr.includes("Could not resolve host") || stderr.includes("无法访问") || stderr.includes("Failed to connect")) {
                            errorMsg = "网络连接失败，请检查网络连接";
                          } else if (stderr.includes("Repository not found") || stderr.includes("仓库未找到")) {
                            errorMsg = "仓库不存在或已被删除";
                          } else if (stderr.includes("terminal prompts disabled") || stderr.includes("could not read Username")) {
                            errorMsg = "这是一个私有仓库，无法自动更新。请手动配置 GitHub Personal Access Token";
                          }
                          Log.error("[MMM-TMM-Control] Git pull 失败:", stderr);
                          self.sendResponse(res, new Error(stderr), {reason: "private_repo", message: errorMsg});
                        } else {
                          Log.log("[MMM-TMM-Control] 成功拉取:", stdout);
                          // 简单判断是否有更新
                          if (stdout.includes("Already up to date") || stdout.includes("已经是最新")) {
                            self.sendResponse(res, undefined, {code: "up-to-date", info: `${name} 已经是最新版本`});
                          } else {
                            // 有更新，需要检查是否需要安装依赖
                            git.status((err, status) => {
                              self.handlePullResult({summary: {changes: 1}}, path, name, res);
                            });
                          }
                        }
                      });
                      return;
                    }

                    let errorMsg = error2.message;
                    if (error2.message.includes("Could not resolve host") || error2.message.includes("无法访问")) {
                      errorMsg = "网络连接失败，请检查网络连接";
                    } else if (error2.message.includes("Repository not found") || error2.message.includes("仓库未找到")) {
                      errorMsg = "仓库不存在或已被删除";
                    }
                    Log.error("[MMM-TMM-Control]", error2);
                    self.sendResponse(res, error2, {reason: "git_error", message: errorMsg});
                    return;
                  }
                  // 成功拉取后继续后续处理
                  self.handlePullResult(result2, path, name, res);
                });
              });
            });
            return;
          }

          // 其他 Git 错误
          let errorMsg = error.message;
          let reason = "git_error";
          if (error.message.includes("could not read Username") || error.message.includes("terminal prompts disabled")) {
            errorMsg = "这是一个私有仓库，无法自动更新。请手动配置 GitHub Personal Access Token";
            reason = "private_repo";
          } else if (error.message.includes("timeout") || error.message.includes("timed out") || error.message.includes("block")) {
            errorMsg = "操作超时，请检查网络连接后重试";
            reason = "network_error";
          } else if (error.message.includes("Could not resolve host") || error.message.includes("无法访问") || error.message.includes("Could not connect to server") || error.message.includes("Failed to connect")) {
            errorMsg = "网络连接失败，请检查网络连接或稍后重试";
            reason = "network_error";
          } else if (error.message.includes("Authentication failed") || error.message.includes("认证失败")) {
            errorMsg = "这是一个私有仓库，需要配置访问权限";
            reason = "private_repo";
          } else if (error.message.includes("Repository not found") || error.message.includes("仓库未找到")) {
            errorMsg = "仓库不存在或已被删除";
            reason = "repo_not_found";
          }
          Log.error("[MMM-TMM-Control]", error);
          self.sendResponse(res, error, {reason, message: errorMsg});
          return;
        }
        self.handlePullResult(result, path, name, res);
      });
      });
    }).catch((error) => {
      Log.error("[MMM-TMM-Control]", error);
      self.sendResponse(res, error, {reason: "git_reset_failed", message: error.message});
    });

  },

  handlePullResult (result, path, name, res) {
    const self = this;
    if (result.summary.changes) {
      const packageJsonExists = fs.existsSync(`${path}/package.json`);
      if (packageJsonExists) {
        const packageJson = JSON.parse(fs.readFileSync(`${path}/package.json`, "utf8"));
        const installNecessary = packageJson.dependencies || packageJson.scripts?.preinstall || packageJson.scripts?.postinstall;
        if (installNecessary) {
          const packageLockExists = fs.existsSync(`${path}/package-lock.json`);
          const command = packageLockExists
            ? "npm ci --omit=dev"
            : "npm install --omit=dev";

          exec(command, {cwd: path, timeout: 120000}, (error, stdout, stderr) => {
            if (error) {
              Log.error("[MMM-TMM-Control]", error);
              self.sendResponse(res, error, {reason: "npm_install_failed", stdout, stderr});
            } else {
              // success part
              self.readModuleData();

              const changelogExists = fs.existsSync(`${path}/CHANGELOG.md`);
              if (changelogExists) {
                const changelog = fs.readFileSync(`${path}/CHANGELOG.md`, "utf-8");
                self.sendResponse(res, undefined, {code: "restart", info: `${name} 更新成功`, chlog: changelog});
              } else {
                self.sendResponse(res, undefined, {code: "restart", info: `${name} 更新成功`});
              }
            }
          });
        } else {
          self.sendResponse(res, undefined, {code: "no-update", info: `${name} 更新成功（无需安装依赖）`});
        }
      } else {
        self.sendResponse(res, undefined, {code: "no-package", info: `${name} 更新成功（无 package.json）`});
      }
    } else {
      self.sendResponse(res, undefined, {code: "up-to-date", info: `${name} 已经是最新版本`});
    }
  },

  checkForExecError (error, stdout, stderr, res, data) {
    if (error) { Log.error("[MMM-TMM-Control]", stderr); }
    this.sendResponse(res, error, data);
  },

  controlPm2 (res, query) {
    const actionName = query.action.toLowerCase();
    const self = this;

    // Use service.sh script from MMM-TMM-Control directory
    // __dirname is /path/to/MagicMirror/modules/MMM-TMM-Control
    const serviceScriptPath = path.join(__dirname, "service.sh");

    // Check if service.sh exists
    if (!fs.existsSync(serviceScriptPath)) {
      const message = `service.sh not found at ${serviceScriptPath}. Please ${actionName} manually.`;
      Log.warn(`[MMM-TMM-Control] ${message}`);
      this.sendResponse(res, undefined, {action: actionName, info: message, status: "warning"});
      return;
    }

    // Send response immediately before executing
    const message = `MagicMirror² ${actionName} command sent successfully`;
    this.sendResponse(res, undefined, {action: actionName, info: message, status: "success"});

    // For restart, create a delayed restart script to survive process termination
    if (actionName === "restart") {
      const restartScript = `#!/bin/bash
sleep 3
cd ${__dirname}
./service.sh restart
`;
      const scriptPath = "/tmp/mm_restart.sh";

      // Write script and execute it in background
      fs.writeFile(scriptPath, restartScript, {mode: 0o755}, (err) => {
        if (err) {
          Log.error(`[MMM-TMM-Control] Failed to create restart script:`, err);
        } else {
          // Execute the script in background, detached from current process
          exec(`nohup ${scriptPath} > /dev/null 2>&1 &`, (error) => {
            if (error) {
              Log.error(`[MMM-TMM-Control] Failed to execute restart script:`, error);
            } else {
              Log.log(`[MMM-TMM-Control] Restart script launched, MM will restart in 3 seconds`);
            }
          });
        }
      });
    } else {
      // For stop, just run normally
      setTimeout(() => {
        exec("./service.sh stop", {cwd: __dirname, timeout: 15000}, (error, stdout, stderr) => {
          if (error) {
            Log.error(`[MMM-TMM-Control] Stop error:`, error);
          } else {
            Log.log(`[MMM-TMM-Control] MagicMirror² stop command executed`);
          }
        });
      }, 100);
    }
  },

  translate (data) {
    if (!this.translation) this.translation = {};
    Object.keys(this.translation).forEach((t) => {
      const pattern = `%%TRANSLATE:${t}%%`;
      const re = new RegExp(pattern, "g");
      data = data.replace(re, this.translation[t]);
    });
    return data;
  },

  saveDefaultSettings () {
    const {moduleData} = this.configData;
    const simpleModuleData = [];
    for (let k = 0; k < moduleData.length; k++) {
      simpleModuleData.push({});
      simpleModuleData[k].identifier = moduleData[k].identifier;
      simpleModuleData[k].hidden = moduleData[k].hidden;
      simpleModuleData[k].lockStrings = moduleData[k].lockStrings;
      simpleModuleData[k].urlPath = moduleData[k].urlPath;
    }

    const text = JSON.stringify({
      moduleData: simpleModuleData,
      brightness: this.configData.brightness,
      temp: this.configData.temp,
      settingsVersion: this.configData.settingsVersion
    });

    fs.writeFile(path.resolve(`${__dirname}/settings.json`), text, (err) => {
      if (err) {
        throw err;
      }
    });
  },

  in (pattern, string) { return includes(pattern, string); },

  loadDefaultSettings () {
    const self = this;

    fs.readFile(path.resolve(`${__dirname}/settings.json`), (error, data) => {
      if (error) {
        if (self.in("no such file or directory", error.message)) {
          return;
        }
        Log.error("[MMM-TMM-Control]", error);
      } else {
        data = JSON.parse(data.toString());
        self.sendSocketNotification("DEFAULT_SETTINGS", data);
      }
    });
  },

  fillTemplates (data) {
    data = this.translate(data);
    // Replace config path placeholder
    const configPath = typeof global.configuration_file !== "undefined"
      ? global.configuration_file
      : "config/config.js";
    data = data.replace(/%%CONFIG_PATH%%/g, configPath);
    return data;
  },

  loadTranslation (language) {
    const self = this;

    try {
      const data = fs.readFileSync(path.resolve(`${__dirname}/translations/${language}.json`), 'utf8');
      self.translation = {...self.translation, ...JSON.parse(data)};
    } catch (err) {
      Log.error(`[MMM-TMM-Control] Failed to load translation for language: ${language}`);
    }
  },

  loadCustomMenus () {
    if ("customMenu" in this.thisConfig) {
      const menuPath = path.resolve(`${__dirname}/../../config/${this.thisConfig.customMenu}`);
      if (!fs.existsSync(menuPath)) {
        Log.log(`[MMM-TMM-Control] customMenu requested, but file:${menuPath} was not found.`);
        return;
      }
      fs.readFile(menuPath, (err, data) => {
        if (err) {
          return;
        } else {
          this.customMenu = {...this.customMenu, ...JSON.parse(this.translate(data.toString()))};
          this.sendSocketNotification("REMOTE_CLIENT_CUSTOM_MENU", this.customMenu);
        }
      });
    }
  },

  getIpAddresses () {
    // module started, answer with current IP address
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const k in interfaces) {
      for (const k2 in interfaces[k]) {
        const address = interfaces[k][k2];
        if (address.family === "IPv4" && !address.internal) {
          addresses.push(address.address);
        }
      }
    }
    return addresses;
  },

  socketNotificationReceived (notification, payload) {
    const self = this;

    if (notification === "CURRENT_STATUS") {
      this.configData = payload;
      this.thisConfig = payload.remoteConfig;
      if (!this.initialized) {
        // Do anything else required to initialize
        this.initialized = true;
      } else {
        this.waiting.forEach((o) => { o.run(); });
        this.waiting = [];
      }
    }
    if (notification === "REQUEST_DEFAULT_SETTINGS") {
      // module started, answer with current ip addresses
      self.sendSocketNotification("IP_ADDRESSES", self.getIpAddresses());
      self.sendSocketNotification("LOAD_PORT", self.configOnHd.port ? self.configOnHd.port : "");
      // check if we have got saved default settings
      self.loadDefaultSettings();
    }
    if (notification === "REMOTE_ACTION") {
      if ("action" in payload) {
        this.executeQuery(payload, {isSocket: true});
      } else if ("data" in payload) {
        this.answerGet(payload, {isSocket: true});
      }
    }
    if (notification === "UNDO_CONFIG") {
      const backupHistorySize = 5;
      let iteration = -1;

      for (let i = backupHistorySize - 1; i > 0; i--) {
        const backupPath = path.resolve(`config/config.js.backup${i}`);
        try {
          const stats = fs.statSync(backupPath);
          if (stats.mtime.toISOString() == payload) {
            iteration = i;
            i = -1;
          }
        } catch (error) {
          Log.debug(`Backup ${i} does not exist: ${error}.`);
          continue;
        }
      }
      if (iteration < 0) {
        this.answerGet({data: "saves"}, {isSocket: true});
        return;
      }
      const backupPath = path.resolve(`config/config.js.backup${iteration}`);
      const req = require(backupPath);

      this.answerPost({data: "config"}, {body: req}, {isSocket: true});
    }
    if (notification === "NEW_CONFIG") {
      this.answerPost({data: "config"}, {body: payload}, {isSocket: true});
    }
    if (notification === "REMOTE_CLIENT_CONNECTED") {
      this.sendSocketNotification("REMOTE_CLIENT_CONNECTED");
      this.loadCustomMenus();
      if ("id" in this.moduleApiMenu) {
        this.sendSocketNotification("REMOTE_CLIENT_MODULEAPI_MENU", this.moduleApiMenu);
      }
    }
    if (notification === "REMOTE_NOTIFICATION_ECHO_IN") {
      this.sendSocketNotification("REMOTE_NOTIFICATION_ECHO_OUT", payload);
    }
    if (notification === "USER_PRESENCE") {
      this.userPresence = payload;
    }

    /* API EXTENSION -- added v2.0.0 */
    if (notification === "REGISTER_API") {
      if ("module" in payload) {
        if ("actions" in payload && Object.keys(payload.actions).length > 0) {
          this.externalApiRoutes[payload.module] = payload;
        } else {
        // Blank actions means the module has requested to be removed from API
          delete this.externalApiRoutes[payload.module];
        }
        this.updateModuleApiMenu();
      }
    }
  },
  ...require("./API/api.js")
});
