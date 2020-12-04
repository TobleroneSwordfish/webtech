# Planetside 2 player statistics website
This is a NodeJS web server, created for the UoB webtech unit. It uses websockets to subscribe to events from the game's [Census API](http://census.daybreakgames.com/) and fetch requests to retrieve data on specific players. The server then stores the data from said events in a MySQL database and displays statistics about that data on a live updating webpage implemented using more websockets and fetch requests.

This project is a collaboration between [Jonny Hall](https://github.com/TobleroneSwordfish) and [Theo Xirouchaki](https://github.com/theo-xir) and was graded 75%.
