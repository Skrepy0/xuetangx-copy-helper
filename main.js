// ==UserScript==
// @name         学堂在线习题复制
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @namespace    https://github.com/Skrepy0/xuetangx-copy-helper
// @supportURL   https://github.com/Skrepy0/xuetangx-copy-helper/issues
// @source     	 https://github.com/Skrepy0/xuetangx-copy-helper
// @license    	 MIT
// @description  在学堂在线习题页面的导航栏添加复制按钮，支持一键复制当前练习的全部题目
// @author       Skrepy
// @match        https://www.xuetangx.com/learn/*/*/*/exercise/*
// @grant        none
// @icon         https://proxt-cdn.xuetangx.com/fe-proxtassets/xuetangX/0329/logo.ico
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";
  let exercise_data = null;
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
            exercise_data = data;
          })
          .catch((e) => console.warn("[CopyHelper]:JSON解析失败", e));
        return response;
      });
    }
    return originalFetch.apply(this, args);
  };
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;
  XHR.open = function (method, url, ...rest) {
    this._url = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };
  XHR.send = function (body) {
    if (this._url && this._url.includes("/get_exercise_list/")) {
      this.addEventListener("load", () => {
        if (this.status === 200) {
          try {
            const data = JSON.parse(this.responseText);
            console.log("[CopyHelper]:[XHR捕获] 习题数据", data);
            exercise_data = data;
          } catch (e) {}
        }
      });
    }
    return originalSend.apply(this, [body]);
  };

  function extractAnswersFromDOM() {
    const answers = [];
    const questionContainers = document.querySelectorAll(
      '.question-item, .exercise-question, [class*="questionItem"]',
    );
    if (questionContainers.length === 0) {
      console.log("[CopyHelper]:未找到题目容器，尝试备用选择器");
      const answerSpans = document.querySelectorAll(
        ".correct-answer, .right-answer, .answer-text, .analysis .correct",
      );
      for (let el of answerSpans) {
        answers.push(el.innerText.trim());
      }
      return answers;
    }
    for (let container of questionContainers) {
      let answer = "";
      const ansEl = container.querySelector(
        '.correct-answer, .right-answer, .answer, .analysis .correct, [class*="answer"]',
      );
      if (ansEl) {
        answer = ansEl.innerText.trim();
        const match = answer.match(/([A-Z]+)\b/);
        if (match) answer = match[1];
      }
      answers.push(answer);
    }
    console.log("[CopyHelper]:提取到的答案", answers);
    return answers;
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

  function stripHtml(html) {
    if (!html) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  function fallbackCopy(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    console.log("[CopyHelper]:降级复制完成");
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
    console.log("[CopyHelper]:按钮被点击，尝试复制题目...");
    if (!exercise_data) {
      showTemporaryText(btn, "数据未就绪", 2000);
      return;
    }
    const answers = extractAnswersFromDOM();
    const textToCopy = formatQuestions(exercise_data, answers);
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

  const onDomChange = (mutationsList, observer) => {
    const targetContainer = document.querySelector(TARGET_SELECTOR);
    if (!targetContainer) return;
    if (targetContainer.querySelector("#" + BUTTON_ID)) return;

    const copy_btn = document.createElement("button");
    copy_btn.id = BUTTON_ID;
    copy_btn.textContent = "复制题目";
    copy_btn.style.backgroundColor = "#3b7cff";
    copy_btn.style.color = "#ffffff";
    copy_btn.style.border = "none";
    copy_btn.style.padding = "6px 12px";
    copy_btn.style.borderRadius = "4px";
    copy_btn.style.fontSize = "14px";
    copy_btn.style.fontWeight = "bold";
    copy_btn.style.cursor = "pointer";
    copy_btn.style.marginLeft = "10px";
    copy_btn.style.transition = "background 0.2s, transform 0.1s ease";
    copy_btn.style.outline = "none";

    copy_btn.addEventListener("mouseenter", () => {
      copy_btn.style.backgroundColor = "#295fcc";
    });
    copy_btn.addEventListener("mouseleave", () => {
      copy_btn.style.backgroundColor = "#3b7cff";
    });

    copy_btn.addEventListener("click", (event) => {
      const btn = event.currentTarget;
      btn.style.transform = "scale(0.95)";
      setTimeout(() => {
        btn.style.transform = "scale(1)";
        getQuestionData(btn);
      }, 100);
    });

    targetContainer.appendChild(copy_btn);
    console.log("[CopyHelper]:按钮添加成功");
  };

  const observer = new MutationObserver(onDomChange);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  onDomChange(null, null);
})();
