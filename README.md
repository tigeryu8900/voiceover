# Voiceover

A tool to dub a mp4 using a vtt transcript using WellSaid Labs

## Usage

Before running the command, make sure to rename `.env.bac` to
`.env` and change the`EMAIL`, `PASSOWORD`, and `PROJECT` fields.

```shell
Options:
      --version  Show version number                                   [boolean]
  -i, --video    input video                        [string] [default: "zh.mp4"]
  -t, --vtt      input transcript                  [boolean] [default: "en.vtt"]
  -o, --output   output video                       [string] [default: "zh.mp4"]
  -v, --verbose  run in verbose mode                                   [boolean]
  -h, --help     Show help                                             [boolean]
```

Example:

```shell
$ node voiceover.js --video=zh.mp4 --vtt=en.vtt
```