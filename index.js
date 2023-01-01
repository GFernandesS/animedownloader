#! /usr/bin/env node

import { chromium } from "playwright";
import { program } from "commander";
import fs from "fs";
import pathLib from "path";
import figlet from "figlet";
import chalk from "chalk";
import emoji from "node-emoji";
import { PlaywrightBlocker } from "@cliqz/adblocker-playwright";
import fetch from "cross-fetch"; // required 'fetch'

const colorOfText = "#FFC0CB";
const emojiOfSteps = emoji.get("shinto_shrine");
const downloads = [];

console.log(
  chalk.hex(colorOfText).bold(figlet.textSync("Anime Downloader", {})),
);

program.description(
  "CLI criada para automatizar o download de episódios do BetterAnimes.Com",
);

const createFolder = (path, animeName) => {
  if (fs.readdirSync(path).includes(animeName)) return;

  const pathToCreate = `${path}/${animeName}`;
  if (!fs.existsSync(pathToCreate)) {
    fs.mkdirSync(pathToCreate);
  }
};

const removeAccents = (text) => {
  text = text.replace(new RegExp("[ÁÀÂÃ]", "gi"), "a");
  text = text.replace(new RegExp("[ÉÈÊ]", "gi"), "e");
  text = text.replace(new RegExp("[ÍÌÎ]", "gi"), "i");
  text = text.replace(new RegExp("[ÓÒÔÕ]", "gi"), "o");
  text = text.replace(new RegExp("[ÚÙÛ]", "gi"), "u");
  text = text.replace(new RegExp("[Ç]", "gi"), "c");
  return text;
};

const getEpisodeList = async (page, urlBase) => {
  console.log(
    chalk.hex(colorOfText).bold("Buscando lista de episódios...") +
      emojiOfSteps,
  );
  await page.goto(urlBase);

  const result = await page.evaluate(() =>
    Array.from(
      document.getElementsByTagName("h3"),
      (element) => element.textContent,
    ),
  );

  return result.map((episode) => formatEpisodeName(episode));
};

const formatEpisodeName = (episodeName) => {
  return removeAccents(
    episodeName
      .replace("[", "")
      .replace("]", "")
      .replace(new RegExp("\\s", "g"), "-")
      .replace(new RegExp("[-]{2,}", "g"), "-")
      .toLowerCase(),
  );
};

const validateDownloads = async (browser) => {
  const hasNonFinishedDownloads = downloads.some((x) => x.isResolved == false);

  if (hasNonFinishedDownloads) {
    console.log(
      chalk
        .hex(colorOfText)
        .bold("Aguardando downloads pendentes serem finalizados... ") +
        emojiOfSteps,
    );
    const [downloads] = await Promise.all(downloads);

    console.log(
      chalk.hex(colorOfText).bold("Episódios baixados! ") + emojiOfSteps,
    );
  }
  browser.close();
};

const validateAndRemoveFromListEpisodesAlreadyDownloaded = (
  animePath,
  episodes,
) => {
  const episodesAlreadyDownloaded = fs.readdirSync(animePath);

  return episodes.filter(
    (episode) => !episodesAlreadyDownloaded.includes(episode),
  );
};

const applyAdBlockOnPageInstance = (page) => {
  if (!page) return;

  PlaywrightBlocker.fromPrebuiltAdsAndTracking(fetch).then((blocker) => {
    blocker.enableBlockingInPage(page);
  });
};

program
  .command("download")
  .description("Comando para baixar os episódios")
  .requiredOption("-n, --name <type>", "Nome do anime")
  .option("-d, --dubbed", "Flag para indicar se os episódios são dublados")
  .option(
    "-s, --single",
    "Flag para indicar se deseja baixar apenas um episódio completo vez",
  )
  .option(
    "--continueWhenNotFound",
    "Continua com os downloads mesmo se um episódio não for encontrado",
  )
  .requiredOption(
    "-p, --path <type>",
    "Caminho onde deseja salvar os episódios",
  )
  .action(async ({ name, dubbed, single, path, continueWhenNotFound }) => {
    try {
      console.log(
        chalk
          .hex(colorOfText)
          .bold("Criando pasta para os episódios no diretório informado...") +
          emojiOfSteps,
      );

      createFolder(path, name);

      const absolutePath = pathLib.resolve(path);

      const browser = await chromium.launch({ headless: false });

      const context = await browser.newContext({ acceptDownloads: true });

      console.log(
        chalk.hex(colorOfText).bold("Lançando browser... ") + emojiOfSteps,
      );

      const page = await context.newPage();

      applyAdBlockOnPageInstance(page);

      const urlBase = `https://betteranime.net/anime/${
        Boolean(dubbed) ? "dublado" : "legendado"
      }/${name}`;

      const episodes = await getEpisodeList(page, urlBase);

      console.log(chalk.hex(colorOfText).bold(`Episódios encontrados:`));

      console.log(episodes);

      console.log(
        chalk
          .hex(colorOfText)
          .bold("Validando episódios já baixados previamente... ") +
          emojiOfSteps,
      );

      const filteredEpisodesToDownload =
        validateAndRemoveFromListEpisodesAlreadyDownloaded(
          `${absolutePath}/${name}`,
          episodes,
        );

      console.log(
        chalk.hex(colorOfText).bold(`Episódios que tentarão ser baixados:`),
      );
      console.log(filteredEpisodesToDownload);

      for (let episode of filteredEpisodesToDownload) {
        const pageForEpisode = await context.newPage();

        applyAdBlockOnPageInstance(pageForEpisode);
        console.log(
          chalk
            .hex(colorOfText)
            .bold(`Acessando página de download do episódio ${episode}... `) +
            emojiOfSteps,
        );

        await pageForEpisode.goto(`${urlBase}/${episode}/download`);

        await pageForEpisode.click('a[class="btn btn-danger mb-2"]');

        await pageForEpisode.click('button[class="mb-5 btn btn-warning"]');
        let download;
        try {
          const downloadPromise = pageForEpisode.waitForEvent("download", {
            timeout: 5000,
          });
          await pageForEpisode.getByText("Baixar").click();

          download = await downloadPromise;
        } catch (error) {
          console.log(
            chalk
              .hex(colorOfText)
              .bold(
                `O episódio ${episode} não está disponível para download... `,
              ) + emojiOfSteps,
          );

          if (!continueWhenNotFound) {
            throw error;
          }

          continue;
        }
        console.log(
          chalk
            .hex(colorOfText)
            .bold(`Efetuando o download do episódio: '${episode}' ... `) +
            emojiOfSteps,
        );

        const filePath = `${absolutePath}/${name}/${episode}.mp4`;
        if (single) await download.saveAs(filePath);
        else {
          const downloadResult = download.saveAs(filePath);
          let isResolved = false;
          downloadResult.then(() => {
            console.log(
              chalk
                .hex(colorOfText)
                .bold(`Download do episódio finalizado: '${episode}' ... `) +
                emojiOfSteps,
            );
            isResolved = true;
          });
          downloads.push({
            download: download,
            downloadResult,
            isResolved,
          });
        }
      }
      await validateDownloads(browser);
    } catch (error) {
      console.log("Houve um erro na execução do processo: " + error.message);
      throw error;
    }
  });

program.parse(process.argv);
