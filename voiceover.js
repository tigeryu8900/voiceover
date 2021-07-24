const { video, vtt, output, verbose } = require('yargs').options({
  'i': {
    alias : 'video',
    describe: 'input video',
    type: 'string',
    demand: false,
    default: 'zh.mp4'
  },
  't': {
    alias : 'vtt',
    describe: 'input transcript',
    type: 'string',
    demand: false,
    default: 'en.vtt'
  },
  'o': {
    alias : 'output',
    describe: 'output video',
    type: 'string',
    demand: false,
    default: 'en.mp4'
  },
  'v': {
    alias : 'verbose',
    describe: 'run in verbose mode',
    type: 'boolean',
    demand: false
  }
}).alias('h', 'help').argv;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);
const fs = require('fs');
const { parse } = require('node-webvtt');
const fetch = require('node-fetch');
const { getAudioDurationInSeconds } = require('get-audio-duration');
const puppeteer = require('puppeteer');
require('dotenv').config();

const tempoLimit = JSON.parse(process.env.TEMPO);

(async () => {
  if (verbose) console.log(`using video ${video} and transcript ${vtt} to generate en.mp4...`);
  const cues = await (async () => {
    var parsed = parse(await fs.promises.readFile(vtt, 'utf-8'));
    if (!parsed.valid) throw parsed.errors;
    return parsed.cues;
  })();

  if (verbose) console.log('launching puppeteer...');
  const browser = await puppeteer.launch({headless: !verbose});
  if (verbose) console.log('signing in...');
  var page = await browser.newPage();
  await page.goto('https://wellsaidlabs.com/auth/sign_in');
  await page.type('#email', process.env.EMAIL);
  await page.type('#password', process.env.PASSWORD);
  await page.click('#sign-in-form > button');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  await page.close();
  if (verbose) console.log('opening project...');
  page = await browser.newPage();

  await page.goto('https://wellsaidlabs.com');
  await page.exposeFunction('nodeError', console.error);
  async function getAudio(text = 'test', speaker = process.env.AVATAR_ID || 16) {
    return await page.evaluate((text, speaker, project) => {
      var reader = new FileReader();
      return fetch('https://wellsaidlabs.com/api/v1/text_to_speech/stream', {
        method: 'POST',
        headers: {
          "mode": "cors",
          "accept": "*/*",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json; charset=UTF-8",
          "cookie": document.cookie,
          "origin": "https://wellsaidlabs.com",
          "referer": `https://wellsaidlabs.com/dashboard/studio/${project}`,
          "sec-ch-ua": `"Not A;Brand";v="99", "Chromium";v="92"`,
          "sec-ch-ua-mobile": "?0",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          "projectId": "4ae26a5d-88cc-416f-bf7a-7361aa4646c7",
          "text": text,
          "speaker_id": speaker,
          "speaker_variant_id": speaker,
          "version": "latest"
        })
      }).then(r => {
        return new Promise((resolve, reject) => {
          if (r.ok) r.blob().then(r => resolve(r));
          else r.text().then(t => reject(
            nodeError(`Error: Request for audio "${text}" failed with status code ${r.status} and body`, JSON.parse(t)))
          );
        });
      }).then(r => {
        reader.readAsBinaryString(r);
        return new Promise((resolve, reject) => reader.addEventListener("load", () => resolve(reader.result)));
      });
    }, text, speaker, process.env.PROJECT);
  }

  var cuesLeft = cues.length;

  var tempos = {};
  async function processCue(cue) {
    if (verbose) console.log(`Requesting audio for "${cue.text}"...`);
    var audio = await getAudio(cue.text);
    await fs.promises.writeFile(`tmp/${cue.start}.mp3`, audio, 'binary');
    var duration = await getAudioDurationInSeconds(`tmp/${cue.start}.mp3`);
    var tempo = Math.min(Math.max(duration / (cue.end - cue.start), tempoLimit[0]), tempoLimit[1]).toFixed(1);
    if (verbose) console.log(
      `text: ${cue.text}${'\n'}start: ${cue.start}, end: ${cue.end}, duration: ${duration}, ` +
      `targetDuration: ${cue.end - cue.start}, tempo: ${tempo}${'\n'}`
    );
    tempos[cue.start] = tempo;
    cuesLeft--;
    if (cuesLeft <= 0) merge();
  }

  for (var cue of cues) {
    processCue(cue);
  }

  function merge() {
    if (verbose) console.log('merging audio clips...');
    var out = ffmpeg(video);
    var filters = [];
    var audios = '';
    for (var i = 0; i < cues.length; i++) {
      out.input(`tmp/${cues[i].start}.mp3`);
      filters.push(`[${i + 1}:a] atempo=${tempos[cues[i].start]}, adelay=${cues[i].start * 1000}:all=1 [a${i + 1}]`);
      audios += `[a${i + 1}]`;
    }
    filters.push(`${audios}amix=inputs=${cues.length}[a]`);
    out.complexFilter(filters)
      .outputOptions(['-map 0:v', '-map [a]'])
      .audioCodec('aac')
      .videoCodec('copy')
      .save(output)
      .on('end', () => {
        verbose ? console.log(`${output} finished rendering`) : undefined;
        browser.close();
        if (!verbose) fs.readdir('tmp', (err, files) => {
          if (err) throw err;
          for (const file of files) {
            fs.unlink(path.join('tmp', file), err => {
              if (err) throw err;
            });
          }
        });
      });
  }
})();
