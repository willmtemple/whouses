import npm = require("api-npm");
import cheerio = require("cheerio");
import fetch from "node-fetch";

import * as fs from "fs";

import packages from "./scan.json";

const URL_BASE = "https://www.npmjs.com";
const PATH = "/browse/depended";

function mkUrl(pkg: string): string {
  return `${URL_BASE}${PATH}/${pkg}`;
}

interface ModuleInfo {
  name: string;
  description?: string;
  published: Date;
}

function scrape(
  url: string,
  accum: ModuleInfo[],
  cb: (data: ModuleInfo[]) => void
): void {
  fetch(url)
    .then(async resp => {
      if (resp.status - 200 >= 100) {
        throw new Error("Received a non-200 status code: " + resp.status);
      }
      const $ = cheerio.load(await resp.text());

      const dependentElements = $("main section h3");

      const dependents = dependentElements.toArray().map((e, _idx) => {
        const container = e.parent.parent.parent;
        const hasDescription = container.children[4] !== undefined;

        const time = hasDescription
          ? container.children[4].children[1].attribs.title.replace(
              "and Latest Version",
              ""
            )
          : container.children[2].children[1].attribs.title.replace(
              "and Latest Version",
              ""
            );

        return {
          name: e.children[0].data as string,
          description: hasDescription
            ? container.children[2].children[0].data
            : undefined,
          published: new Date(time)
        };
      });

      const nextPageAnchor = $("div.dib a")[0];

      accum = accum.concat(dependents);

      if (nextPageAnchor && nextPageAnchor.children[0].data === "Next Page") {
        scrape(`${URL_BASE}${nextPageAnchor.attribs.href}`, accum, cb);
      } else {
        cb(accum);
      }
    })
    .catch(e => console.error(e));
}

function writeFile(f: string, url: string) {
  scrape(url, [], data => {
    data.sort((a, b) =>
      a.published < b.published ? 1 : a.published > b.published ? -1 : 0
    );

    let accum = "package,url,description,published,contributors\n";

    data
      .reduce(
        (chain, v): Promise<void> =>
          chain.then(() => {
            return new Promise(resolve =>
              npm.getdetails(v.name, (data: any) => {
                accum += '"' + v.name.replace("@", "__") + '",';
                accum += (data.repository && data.repository.url) + ",";
                accum += v.description + ",";
                accum += v.published + ",";
                accum +=
                  '"' +
                  data.maintainers
                    .map((c: any) => `${c.name} <${c.email}>`)
                    .join(",") +
                  '"';
                accum += "\n";
                resolve();
              })
            );
          }),
        Promise.resolve()
      )
      .then(() => {
        fs.writeFile(f, accum, err => {
          if (err) {
            console.error("Could not write file ", f, ": ", err);
          } else {
            console.info("Successfully wrote: ", f);
          }
        });
      })
      .catch(e => {
        console.error("Failed to process modules: ", e);
        console.error("Occurred processing output: ", f);
      });
  });
}

fs.existsSync('out') || fs.mkdirSync('out');

packages.forEach(pkgName => {
  const fullUrl = mkUrl(pkgName);
  const oFPath = `out/${pkgName.replace("@", "_").replace("/", "-")}.csv`;

  writeFile(oFPath, fullUrl);
});
