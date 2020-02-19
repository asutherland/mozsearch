let treeRoot = scriptArgs[0];
let indexRoot = scriptArgs[1];
let mozSearchRoot = scriptArgs[2];
let treeName = scriptArgs[3];

run(mozSearchRoot + "/scripts/output-lib.js");
run(mozSearchRoot + "/scripts/output.js");

let opt = {tree: treeName,
           title: "{{TITLE}} - mozsearch"};

// ## Non-fancy "search" template
let searchBody = `<script>
      var results = {{BODY}};
      window.addEventListener("load", function() { showSearchResults(results); });
    </script>`;

let output = generateOld(searchBody, opt);

// Redirect stdout to the output file, saving off stdout
let old = redirect(indexRoot + "/templates/search.html");
print(output);
// Restore stdout
os.file.close(redirect(old));

// ## Fancy "sorch" template
searchBody = `<script>
      window.SEARCH_RESULTS = {{BODY}};
    </script>`;
output = generateFancy(searchBody, opt);
old = redirect(indexRoot + "/templates/sorch.html");
print(output);
// Restore stdout
os.file.close(redirect(old));
