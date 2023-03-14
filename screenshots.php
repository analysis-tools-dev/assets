<?php

// Get all tools names from `screenshots` directory
// and generate a JSON object with the tool name as key
// and an array of all screenshots as value.

require_once('vendor/autoload.php');

use ImageKit\ImageKit;
use Dotenv\Dotenv;


$dotenv = Dotenv::createUnsafeImmutable(__DIR__);
$dotenv->safeLoad();

// Use getenv to check env variables; exit if they are not set
if (!getenv('IMAGEKIT_PUBLIC_KEY') || !getenv('IMAGEKIT_PRIVATE_KEY')) {
    echo "Please set the IMAGEKIT_PUBLIC_KEY and IMAGEKIT_PRIVATE_KEY environment variables" . PHP_EOL;
    exit(1);
}

$imageKit = new ImageKit(
    getenv('IMAGEKIT_PUBLIC_KEY'),
    getenv('IMAGEKIT_PRIVATE_KEY'),
    "https://ik.imagekit.io/analysistools"
);

// Get all tools names from `screenshots` directory
$tools = array_diff(scandir('screenshots'), array('..', '.', '.DS_Store'));
$tools = array_values($tools);

// Generate JSON object
$json = array();
foreach ($tools as $tool) {
    $screenshots = array_diff(scandir('screenshots/' . $tool), array('..', '.'));
    $screenshots = array_values($screenshots);
    $json[$tool] = array();
    foreach ($screenshots as $screenshot) {
        $screenshotPath = 'screenshots/' . $tool . '/' . $screenshot;
        echo "Handling $screenshotPath" . PHP_EOL;

        // Check if `$screenshotPath` was created since yesterday
        $created  = filectime($screenshotPath);
        $yesterday = time() - (60 * 60 * 24);

        if ($created > $yesterday) {
            echo "Screenshot was not changed recently. Skipping" . PHP_EOL;
            continue;
        }

        echo "Uploading $screenshotPath. Changed " . date('Y-m-d H:i:s', $created) . PHP_EOL;

        // Load screenshot from disk
        $screenshotFile = file_get_contents($screenshotPath);
        if (!$screenshotFile) {
            echo "Error loading screenshot from disk" . PHP_EOL;
            continue;
        }

        $encodedImageData = base64_encode($screenshotFile);
        if (!$encodedImageData) {
            echo "Error encoding screenshot" . PHP_EOL;
            continue;
        }

        $fileName = $tool . '/' . $screenshot;

        echo "Uploading file to ImageKit" . PHP_EOL;
        $response = $uploadFile = $imageKit->uploadFile([
            'file' => $encodedImageData,
            'fileName' => $fileName
        ]);

        if ($response->error) {
            echo "Error uploading file to ImageKit" . PHP_EOL;
            echo $response->error . PHP_EOL;
        }

        // Get CDN image URL
        $path = $response->result->url;

        if (!$path || $path === '') {
            echo "Error getting CDN image URL for $fileName" . PHP_EOL;
            continue;
        }

        // Get the last part of the path (the filename), remove the extension
        // and urldecode it to get the website URL of the tool.
        $url = urldecode(pathinfo($screenshot, PATHINFO_FILENAME));


        // Add screenshot to JSON object
        $json[$tool][] = array(
            'path' => $path,
            'url' => $url
        );
    }
}

file_put_contents('screenshots.json', json_encode($json, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
