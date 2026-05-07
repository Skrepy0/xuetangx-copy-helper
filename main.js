// ==UserScript==
// @name         学堂在线习题复制
// @namespace    https://github.com/Skrepy0/xuetangx-copy-helper
// @version      1.0.1
// @description  在学堂在线习题页面的导航栏添加复制按钮，支持一键复制当前练习的全部题目及答案
// @author       Skrepy
// @match        https://www.xuetangx.com/learn/**/exercise/**
// @grant        none
// @icon         https://proxt-cdn.xuetangx.com/fe-proxtassets/xuetangX/0329/logo.ico
// @run-at       document-idle
// @license      MIT
// @supportURL   https://github.com/Skrepy0/xuetangx-copy-helper/issues
// @source       https://github.com/Skrepy0/xuetangx-copy-helper
// ==/UserScript==

(function () {
  "use strict";

  let exerciseData = null;
  let copyBtnTimeout = null;

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = args[0];
    if (typeof url === "string" && url.includes("/get_exercise_list/")) {
      return originalFetch.apply(this, args).then((response) => {
        const cloned = response.clone();
        cloned
          .json()
          .then((data) => {
            console.log("[CopyHelper]:Fetch捕获 习题数据", data);
            exerciseData = data;
          })
          .catch((e) => console.warn("[CopyHelper]:JSON解析失败", e));
        return response;
      });
    }
    return originalFetch.apply(this, args);
  };

  const xhrProto = XMLHttpRequest.prototype;
  const originalXHROpen = xhrProto.open;
  const originalXHRSend = xhrProto.send;
  xhrProto.open = function (method, url, ...rest) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  xhrProto.send = function (body) {
    if (this._url && this._url.includes("/get_exercise_list/")) {
      this.addEventListener("load", () => {
        if (this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);
            console.log("[CopyHelper]:[XHR捕获] 习题数据", data);
            exerciseData = data;
          } catch (e) {}
        }
      });
    }
    return originalXHRSend.apply(this, [body]);
  };

  function extractAnswersFromApi(data) {
    if (!data || !data.data || !data.data.problems) return [];
    const problems = data.data.problems;
    const answers = [];
    for (let p of problems) {
      let ans = "";
      if (p.user && p.user.answer) ans = p.user.answer;
      else if (p.user && p.user.correctAnswer) ans = p.user.correctAnswer;
      else if (p.user && p.user.selected) ans = p.user.selected;
      else if (p.answer) ans = p.answer;
      else if (p.correctAnswer) ans = p.correctAnswer;
      if (ans && typeof ans === "string") ans = ans.trim();
      answers.push(ans || "");
    }
    return answers;
  }

  function extractAnswersFromDOM() {
    const answers = [];
    const containers = document.querySelectorAll(".answerCon");
    for (let i = 0; i < containers.length; i++) {
      const container = containers[i];
      const answerLists = container.querySelectorAll(".answerList");
      let answer = "";
      if (answerLists.length >= 2) {
        const ansSpan = answerLists[1].querySelector(".radio_xtb");
        answer = ansSpan ? ansSpan.innerText.trim() : "";
      }
      if (!answer) {
        const rightIcon = container.querySelector(".radio_xtb .right");
        if (rightIcon) {
          const parent = rightIcon.closest(".radio_xtb");
          answer = parent ? parent.innerText.trim() : "";
        }
      }
      answers.push(answer);
    }
    return answers;
  }

  function stripHtml(html) {
    if (!html) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  function formatQuestions(data, answers) {
    if (!data || !data.data || !data.data.problems) {
      return "未获取到题目数据，请稍后重试。";
    }
    const problems = data.data.problems;
    let output = "";

    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      const content = p.content;
      const idx = i + 1;

      const typeText =
        content.TypeText ||
        (content.Type === "SingleChoice"
          ? "单选题"
          : content.Type === "Judgement"
            ? "判断题"
            : "未知");

      let stem = stripHtml(content.Body || "");
      stem = stem.replace(/\s*\n\s*\n\s*/g, "\n").trim();
      stem = stem.replace(/\n+/g, "\n");
      output += `${idx}. ${stem}（${typeText}）\n`;

      if (content.Options && content.Options.length) {
        for (const opt of content.Options) {
          let optText = stripHtml(opt.value);
          optText = optText.replace(/\s*\n\s*/g, " ").trim();
          output += `${opt.key}. ${optText}\n`;
        }
      } else {
        output += "(无选项)\n";
      }

      if (answers && answers[i] && answers[i].trim() !== "") {
        output += `答案：${answers[i]}\n`;
      }

      if (i !== problems.length - 1) {
        output += "\n";
      }
    }
    return output;
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }

  function showTemporaryText(btn, tempText, duration) {
    if (copyBtnTimeout) clearTimeout(copyBtnTimeout);
    const originalText = btn.textContent;
    btn.textContent = tempText;
    copyBtnTimeout = setTimeout(() => {
      btn.textContent = originalText;
      copyBtnTimeout = null;
    }, duration);
  }

  async function getQuestionData(btn) {
    if (!exerciseData) {
      showTemporaryText(btn, "数据未就绪", 2000);
      return;
    }
    let answers = extractAnswersFromApi(exerciseData);
    if (answers.every((a) => !a)) {
      answers = extractAnswersFromDOM();
    }
    const textToCopy = formatQuestions(exerciseData, answers);
    try {
      await navigator.clipboard.writeText(textToCopy);
      showTemporaryText(btn, "已复制", 5000);
    } catch (err) {
      console.error("[CopyHelper]:Clipboard API 失败，使用降级复制", err);
      fallbackCopy(textToCopy);
      showTemporaryText(btn, "复制成功(降级)", 5000);
    }
  }

  const TARGET_SELECTOR = ".tabbar";
  const BUTTON_ID = "copy-btn";

  const onDomChange = () => {
    const targetContainer = document.querySelector(TARGET_SELECTOR);
    if (!targetContainer) return;
    if (targetContainer.querySelector("#" + BUTTON_ID)) return;

    const copyBtn = document.createElement("button");
    copyBtn.id = BUTTON_ID;
    copyBtn.textContent = "复制题目";
    copyBtn.style.backgroundColor = "#3b7cff";
    copyBtn.style.color = "#ffffff";
    copyBtn.style.border = "none";
    copyBtn.style.padding = "6px 12px";
    copyBtn.style.borderRadius = "4px";
    copyBtn.style.fontSize = "14px";
    copyBtn.style.fontWeight = "bold";
    copyBtn.style.cursor = "pointer";
    copyBtn.style.marginLeft = "10px";
    copyBtn.style.transition = "background 0.2s, transform 0.1s ease";
    copyBtn.style.outline = "none";

    copyBtn.addEventListener("mouseenter", () => {
      copyBtn.style.backgroundColor = "#295fcc";
    });
    copyBtn.addEventListener("mouseleave", () => {
      copyBtn.style.backgroundColor = "#3b7cff";
    });

    copyBtn.addEventListener("click", (event) => {
      const btn = event.currentTarget;
      btn.style.transform = "scale(0.95)";
      setTimeout(() => {
        btn.style.transform = "scale(1)";
        getQuestionData(btn);
      }, 100);
    });

    targetContainer.appendChild(copyBtn);
    console.log("[CopyHelper]:按钮添加成功");
  };

  const observer = new MutationObserver(onDomChange);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  onDomChange();
})();
