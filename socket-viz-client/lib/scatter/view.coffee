require "./style.scss"
d3 = require "d3"

module.exports = ScatterView = (opts) ->
  {@selector, windowHeight, windowWidth} = opts

  @w = windowWidth / 2
  @h = windowHeight / 2

  @xMax = 180
  @yMax = 240

  @pad = 20
  @leftPad = 100

  @players = []
  @data = []

  @colors = ["blue", "yellow", "pink", "green" ]

  @regions = [
    {coords: [[0,0],[59,59], [59,@yMax], [0,@yMax]], fill:"#FFEFE5"}
    {coords: [[60,100], [119,159],[119,@yMax], [60,@yMax]], fill: "#FFE4B5"}
    {coords: [[120,200],[179,259], [159,240], [120,@yMax]], fill: "#FFDAB9"}
  ]

  @penLines = [
    {name: "S", coords: [0,0,180,180]}
    {name: "1 min", coords: [60,0,60,@yMax]}
    {name: "2 min", coords: [120,0,120,@yMax]}
    # {name: "3 min", coords: [180,0,180,300]}
    {name: "100 lines", coords: [0,100,@xMax,100]}
    {name: "200 lines", coords: [0,200,@xMax,200]}
    # time < 60, lines >= time
    {name: "natty 1:00", coords: [0,0,59,59]}
    # time between 60 and 119, lines - 40 >= time
    {name: "natty 2:00", coords: [60,100,119,159]}
    # time between 120 and 179, lines - 80 >= time
    {name: "natty 3:00", coords: [120,200,159,240]}
  ]

  @setupAxisScales()

  @render()
  return this

ScatterView::setupAxisScales = ->

  @xScale = d3.scale.linear()
    .domain([0,@xMax])
    .range([@leftPad, @w-@pad])

  @yScale = d3.scale.linear()
    .domain([0,@yMax])
    .range([@h-@pad*2, @pad])

  @xAxis = d3.svg.axis()
    .scale(@xScale).orient "bottom"

  @yAxis = d3.svg.axis()
    .scale(@yScale).orient "left"

  return

ScatterView::render = ->
  self = this

  @svg = d3.select(@selector)
    .append("svg")
    .attr( "width", @w)
    .attr( "height", @h)

  @svg.append("g")
    .attr("class", "axis")
    .attr("transform", "translate(0, #{@h-@pad})")
    .call @xAxis

  @svg.append("g")
    .attr("class", "axis")
    .attr("transform", "translate(#{@leftPad-@pad}, 0)")
    .call @yAxis

  @svg.append("text")
    .attr("class", "loading")
    .text("Waiting for new data ...")
    .attr("x", -> self.w/2)
    .attr("y", -> self.h/2-5)

  @drawRegions()
  @drawPenlines()

  return this

ScatterView::drawPenlines = ->
  for line in @penLines
    l = line.coords
    @svg.append("line")
      .attr("x1", @xScale(l[0]))
      .attr("y1", @yScale(l[1]))
      .attr("x2", @xScale(l[2]))
      .attr("y2", @yScale(l[3]))
      .attr("stroke", "grey")
      .attr("stroke-width", 1)

ScatterView::drawRegions = ->
  self = this
  for r in @regions
    @svg.selectAll("polygon")
      .data(@regions)
      .enter().append("polygon")
      .attr("points", (d) -> 
        points = d.coords.map (p) -> 
          return [self.xScale(p[0]),self.yScale(p[1])].join ","
        return points.join " "
      )
      .attr("fill", (d) -> 
        return d.fill
      )
      .attr("fill-opacity", 0.5)

ScatterView::drawLegend = (players) ->
  legend = @svg.append("g")
    .attr("class", "legend")
    .attr("height", 100)
    .attr("width", 100)
    .attr("transform", 'translate(-20,50)')

  legend.selectAll("rect")
    .data(players)
    .enter()
    .append("rect")
    .attr("x", @w - 65)
    .attr("y", (d, i) -> i *  20)
    .attr("width", 10)
    .attr("height", 10)
    .style("fill", (d) -> d.color)

  legend.selectAll("text")
    .data(players)
    .enter()
    .append("text")
    .attr("x", @w - 52)
    .attr("y", (d, i) -> i * 20 + 9)
    .text((d) -> d.name)

ScatterView::drawPlot = ->
  self = this

  @svg.selectAll("circle")
    .data(@data)
    .enter()
    .append("circle")
    .attr("class", "circle")
    .attr("cx", (d) -> self.xScale(d.time))
    .attr("cy", (d) -> self.yScale(d.lines))
    # .transition()
    # .duration(800)
    .attr("r", 2)
    .style("fill", (d) -> "#{self.getPlayerColor(d.name, self.players.indexOf(d.name))}")

ScatterView::addPerf = (perf) ->
  self = this
  if @data.length is 0
    @svg.selectAll(".loading").remove()

  @data.push perf

  unless (@players.indexOf perf.name) >= 0
    @players.push perf.name

    pColors = @players.map (p, i) ->
      color = self.getPlayerColor p, i
      {name: p, color: color}

    @drawLegend pColors

  @drawPlot()

ScatterView::getPlayerColor = (p, i) ->
  if p is "Neela" then "red" else @colors[i]


module.exports = ScatterView
