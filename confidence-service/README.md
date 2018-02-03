
[confidence.js](https://github.com/sendwithus/confidence) as a service

[![Build Status](https://travis-ci.org/tphummel/confidence-service.png)](https://travis-ci.org/tphummel/confidence-service)

<a id="mashape-button" data-api="ab-testing-confidence-analysis" data-name="tphummel" data-icon="1" href="https://www.mashape.com/tphummel/ab-testing-confidence-analysis?utm_campaign=embed&utm_medium=button&utm_source=ab-testing-confidence-analysis&utm_content=anchorlink"> AB Testing Confidence Analysis API </a>
<script src="https://www.mashape.com/embed/button.js"></script>


## install

    git clone tphummel/confidence-service
    cd confidence-service
    npm start
    open http://localhost:3000/health

## usage

    % curl -X POST -H 'Content-type: application/json' -d '[{"id":"A","name":"Alluring Alligators","conversionCount":1500,"eventCount":3000},{"id":"B","name":"Belligerent Bumblebees","conversionCount":2500,"eventCount":3000}]' http://localhost:4001/confidence

    {"hasWinner":true,"hasEnoughData":true,"winnerID":"B","winnerName":"Belligerent Bumblebees","confidenceInterval":{"min":82,"max":84.67},"readable":"In a hypothetical experiment that is repeated infinite times, the average rate of the \"Belligerent Bumblebees\" variant will fall between 82% and 84.67%, 95% of the time"}
