// polyfill window.fetch for browsers which don't natively support it.
import 'whatwg-fetch'
import { lightningChart, emptyFill, Themes, ChartXY, LineSeries, AreaRangeSeries, OHLCSeriesTraditional, OHLCCandleStick, OHLCFigures, XOHLC, Point, AxisTickStrategies, VisibleTicks, emptyLine, emptyTick, AreaSeriesTypes, ColorRGBA, Color, SolidFill, AreaPoint, SolidLine, DataPatterns, MarkerBuilders, UIElementBuilders, CustomTick, ColorHEX, UITextBox, UIOrigins, TableContentBuilder, SeriesXY, RangeSeriesFormatter, SeriesXYFormatter, AutoCursorXY, AreaSeriesPositive, UIDraggingModes, translatePoint, UIBackgrounds, FormattingFunctions, NumericTickStrategy, Axis, TickStyle, UIPointableTextBox } from "@arction/lcjs"
import { simpleMovingAverage, exponentialMovingAverage, bollingerBands, relativeStrengthIndex } from '@arction/lcjs-analysis'
import { DataSource } from './dataSources'
import { DataCache, DataRange, DataSourceInfo, OHLCDataFormat } from './dataCache'

// Use theme if provided
const urlParams = new URLSearchParams(window.location.search);
let theme = Themes.dark
if (urlParams.get('theme') == 'light')
    theme = Themes.light

//#region ----- Application configuration -----

// *** Data-source ***
// To run application locally, you'll need to set 'dataSource' with source: DataSource.AlphaVantage, and a valid API token.
// You can get one for free from https://www.alphavantage.co/
let dataSource: DataSourceInfo
dataSource = { source: DataSource.AlphaVantageArctionInternal }
// dataSource = { source: DataSource.AlphaVantage, apiToken: 'API-KEY-HERE' }


// To disable/enable/modify charts inside application, alter values below:
// averagingFrameLength is in "periods", 1 period = the opening time of stock marker for one week-day.
const chartConfigOHLC = {
    show: true,
    verticalSpans: 3,
    /**
     * Simple Moving Average.
     */
    sma: {
        show: true,
        averagingFrameLength: 13, // history data : 13 days.
        averagingFrameLengthIntraday: 1 // intraday data : 1 day
    },
    /**
     * Exponential Moving Average.
     *
     * Uses same averagingFrameLength as above SMA.
     */
    ema: {
        show: true
    },
    /**
     * Bollinger Bands.
     */
    bollinger: {
        show: true,
        averagingFrameLength: 13, // history data : 13 days.
        averagingFrameLengthIntraday: 1 // intraday data : 1 day
    }
}
const chartConfigVolume = {
    show: true,
    verticalSpans: 1
}
const chartConfigRSI = {
    show: true,
    verticalSpans: 1,
    averagingFrameLength: 13, // history data : 13 days.
    averagingFrameLengthIntraday: 1 // intraday data : 1 day
}

//#endregion

//#region ----- Find referenced DOM elements from 'index.html' -----
const domElementIDs = {
    chartContainer: 'trading-chart-container',
    dataSearchInput: 'trading-data-search-input',
    dataSearchActivate: 'trading-data-search-activate',
    dataSearchRange1: 'trading-data-search-range-1',
    dataSearchRange2: 'trading-data-search-range-2',
    dataSearchRange3: 'trading-data-search-range-3'
}
const domElements = new Map<string, HTMLElement>()
Object.keys(domElementIDs).forEach((key) => {
    const domElementID = domElementIDs[key]
    const domElement = document.getElementById(domElementID)
    if (domElement === undefined)
        throw new Error('DOM element not found: ' + domElementID)
    domElements.set(domElementID, domElement)
})

let dataRange = DataRange.Year
domElements.get(domElementIDs.dataSearchRange1).addEventListener('change', () => dataRange = DataRange.Month)
domElements.get(domElementIDs.dataSearchRange2).addEventListener('change', () => dataRange = DataRange.Year)
domElements.get(domElementIDs.dataSearchRange3).addEventListener('change', () => dataRange = DataRange.TenYears)

//#endregion

//#region ----- Create Dashboard and Charts -----

//#region ----- Create Dashboard -----
const chartConfigs = [chartConfigOHLC, chartConfigVolume, chartConfigRSI]
/**
 * Utility function for counting the row span before a specified chart index.
 */
const countRowSpanForChart = (chartIndex: number) => chartConfigs.reduce(
    (sum, chartConfig, i) => sum + (chartConfig.show && i < chartIndex ? chartConfig.verticalSpans : 0),
    0
)

// Create Dashboard inside chart container div. 
const dashboard = lightningChart().Dashboard({
    theme,
    container: domElementIDs.chartContainer,
    numberOfColumns: 1,
    // Count row span for all charts.
    numberOfRows: countRowSpanForChart(chartConfigs.length)
})
//#endregion

// Create custom X tick strategy for indexed Date values. Object must fulfill interface: AxisTickStrategy.
let dateTimeFormatter = { format: (date) => '' }
// Function which gets Date from indexed X coordinate.
let getDateFromIndex: (x: number) => Date = (x) => undefined
const dateTimeTickStrategy = {
    formatValue: (x: number) => dateTimeFormatter.format(getDateFromIndex(Math.round(x)))
}
// Builder for CustomTicks ticks with no Background.
let tickWithoutBackgroundBuilder = UIElementBuilders.PointableTextBox
    .addStyler((pointableTextBox) => pointableTextBox
        .setBackground((background) => background
            .setFillStyle(emptyFill)
            .setStrokeStyle(emptyLine)
            .setPointerLength(0)
        )
    )

//#region ----- Create OHLC Chart -----
let chartOHLC: ChartXY | undefined
let seriesOHLC: OHLCSeriesTraditional<OHLCCandleStick, OHLCCandleStick> | undefined
let seriesSMA: LineSeries | undefined
let seriesEMA: LineSeries | undefined
let seriesBollinger: AreaRangeSeries | undefined
let chartOHLCTitle: UITextBox | undefined

if (chartConfigOHLC.show) {
    chartOHLC = dashboard.createChartXY({
        columnIndex: 0,
        columnSpan: 1,
        rowIndex: countRowSpanForChart(chartConfigs.indexOf(chartConfigOHLC)),
        rowSpan: chartConfigOHLC.verticalSpans
    })

    
    const axisX = chartOHLC.getDefaultAxisX()
    axisX.setTickStrategy(AxisTickStrategies.Numeric, (styler) => styler.setFormattingFunction(dateTimeTickStrategy.formatValue))
    const axisY = chartOHLC.getDefaultAxisY()
    // Create custom title attached to the top of Y Axis.
    const _chartOHLCTitle = chartOHLC.addUIElement(
        UIElementBuilders.TextBox
            .setBackground(UIBackgrounds.Rectangle),
        {
            x: axisX,
            y: axisY
        }
    )
        .setText('')
        .setPosition({ x: 0, y: 10 })
        .setOrigin(UIOrigins.LeftTop)
        .setDraggingMode(UIDraggingModes.notDraggable)
        // Set dark, tinted Background style.
        .setBackground((background) => background
            .setFillStyle(new SolidFill({ color: theme.seriesBackgroundFillStyle.get('color').setA(150) }))
            .setStrokeStyle(emptyLine)
        )
    chartOHLCTitle = _chartOHLCTitle
    // Follow Axis interval changes to keep title positioned where it should be.
    axisX.onScaleChange((start, end) => _chartOHLCTitle.setPosition({ x: start, y: axisY.getInterval().end }))
    axisY.onScaleChange((start, end) => _chartOHLCTitle.setPosition({ x: axisX.getInterval().start, y: end }))

    if (chartConfigOHLC.bollinger.show) {
        // Create Bollinger Series.
        seriesBollinger = chartOHLC.addAreaRangeSeries()
            .setName('Bollinger Band')
            // Disable data-cleaning.
            .setMaxPointCount(undefined)
            // Disable cursor interpolation.
            .setCursorInterpolationEnabled(false)
    }
    if (chartConfigOHLC.sma.show) {
        // Create SMA Series.
        seriesSMA = chartOHLC.addLineSeries()
            .setName('SMA')
            // Disable data-cleaning.
            .setMaxPointCount(undefined)
            // Disable cursor interpolation.
            .setCursorInterpolationEnabled(false)
    }
    if (chartConfigOHLC.ema.show) {
        // Create EMA Series.
        seriesEMA = chartOHLC.addLineSeries()
            .setName('EMA')
            // Disable data-cleaning.
            .setMaxPointCount(undefined)
            // Disable cursor interpolation.
            .setCursorInterpolationEnabled(false)
    }
    // Create OHLC Series.
    seriesOHLC = chartOHLC.addOHLCSeries({
        positiveFigure: OHLCFigures.Candlestick,
        negativeFigure: OHLCFigures.Candlestick
    })
        .setName('OHLC')
        // Disable data-cleaning.
        .setMaxPointCount(undefined)
        // Disable auto fitting of Figures (meaning, show one figure for one input data point).
        .setFigureAutoFitting(false)
}
//#endregion

//#region ----- Create Volume Chart -----
let chartVolume: ChartXY | undefined
let seriesVolume: AreaSeriesPositive | undefined
let chartVolumeTitle: UITextBox | undefined

if (chartConfigVolume.show) {
    chartVolume = dashboard.createChartXY({
        columnIndex: 0,
        columnSpan: 1,
        rowIndex: countRowSpanForChart(chartConfigs.indexOf(chartConfigVolume)),
        rowSpan: chartConfigVolume.verticalSpans
    })

    const axisX = chartVolume.getDefaultAxisX()
    const axisY = chartVolume.getDefaultAxisY()
    axisX.setTickStrategy(AxisTickStrategies.Numeric, (styler) => styler.setFormattingFunction(dateTimeTickStrategy.formatValue))
    // Volume data has a lot of quantity, so better select Units (K, M, etc.).
    axisY.setTickStrategy(AxisTickStrategies.Numeric, (styler) => styler
        .setFormattingFunction(FormattingFunctions.NumericUnits)
    )
    // Create custom title attached to the top of Y Axis.
    const _chartVolumeTitle = chartVolume.addUIElement(
        UIElementBuilders.TextBox
            .setBackground(UIBackgrounds.Rectangle),
        {
            x: axisX,
            y: axisY
        }
    )
        .setText('Volume')
        .setPosition({ x: 0, y: 10 })
        .setOrigin(UIOrigins.LeftTop)
        .setDraggingMode(UIDraggingModes.notDraggable)
        // Set dark, tinted Background style.
        .setBackground((background) => background
            .setFillStyle(new SolidFill({ color: theme.seriesBackgroundFillStyle.get('color').setA(150) }))
            .setStrokeStyle(emptyLine)
        )
    chartVolumeTitle = _chartVolumeTitle
    // Follow Axis interval changes to keep title positioned where it should be.
    axisX.onScaleChange((start, end) => _chartVolumeTitle.setPosition({ x: start, y: axisY.getInterval().end }))
    axisY.onScaleChange((start, end) => _chartVolumeTitle.setPosition({ x: axisX.getInterval().start, y: end }))

    // Create Volume Series.
    seriesVolume = chartVolume.addAreaSeries({
        type: AreaSeriesTypes.Positive
    })
        .setName('Volume')
        // Disable data-cleaning.
        .setMaxPointCount(undefined)
        // Disable cursor interpolation.
        .setCursorInterpolationEnabled(false)
}
//#endregion

//#region ----- Create RSI Chart -----
let chartRSI: ChartXY | undefined
let seriesRSI: LineSeries | undefined
let chartRSITitle: UITextBox | undefined
let ticksRSI: CustomTick[] = []
let tickRSIThresholdLow: CustomTick | undefined
let tickRSIThresholdHigh: CustomTick | undefined

if (chartConfigRSI.show) {
    chartRSI = dashboard.createChartXY({
        columnIndex: 0,
        columnSpan: 1,
        rowIndex: countRowSpanForChart(chartConfigs.indexOf(chartConfigRSI)),
        rowSpan: chartConfigRSI.verticalSpans
    })

    const axisX = chartRSI.getDefaultAxisX()
    const axisY = chartRSI.getDefaultAxisY()
    axisX.setTickStrategy(AxisTickStrategies.Numeric, (styler) => styler.setFormattingFunction(dateTimeTickStrategy.formatValue))
    // Create custom title attached to the top of Y Axis.
    const _chartRSITitle = chartRSI.addUIElement(
        UIElementBuilders.TextBox
            .setBackground(UIBackgrounds.Rectangle),
        {
            x: axisX,
            y: axisY
        }
    )
        .setText('RSI')
        .setPosition({ x: 0, y: 10 })
        .setOrigin(UIOrigins.LeftTop)
        .setDraggingMode(UIDraggingModes.notDraggable)
        // Set dark, tinted Background style.
        .setBackground((background) => background
            .setFillStyle(new SolidFill({ color: theme.seriesBackgroundFillStyle.get('color').setA(150) }))
            .setStrokeStyle(emptyLine)
        );
    chartRSITitle = _chartRSITitle
    // Follow Axis interval changes to keep title positioned where it should be.
    axisX.onScaleChange((start, end) => _chartRSITitle.setPosition({ x: start, y: axisY.getInterval().end }))
    axisY.onScaleChange((start, end) => _chartRSITitle.setPosition({ x: axisX.getInterval().start, y: end }))

    // Create RSI Series.
    seriesRSI = chartRSI.addLineSeries({
        dataPattern: {
            pattern:'ProgressiveX'
        }
    })
        .setName('RSI')
        // Disable data-cleaning.
        .setMaxPointCount(undefined)
        // Disable cursor interpolation.
        .setCursorInterpolationEnabled(false)

    // Create RSI ticks with CustomTicks, to better indicate common thresholds of 30% and 70%.
    axisY
        .setTickStrategy(AxisTickStrategies.Empty)
        // RSI interval always from 0 to 100.
        .setInterval(0, 100)
        .setScrollStrategy(undefined)

    ticksRSI.push(axisY.addCustomTick(tickWithoutBackgroundBuilder)
        .setValue(0)
        // Disable gridline.
        .setGridStrokeLength(0)
    )
    ticksRSI.push(axisY.addCustomTick(tickWithoutBackgroundBuilder)
        .setValue(100)
        // Disable gridline.
        .setGridStrokeLength(0)
    )
    tickRSIThresholdLow = axisY.addCustomTick(tickWithoutBackgroundBuilder)
        .setValue(30)
    ticksRSI.push(tickRSIThresholdLow)
    tickRSIThresholdHigh = axisY.addCustomTick(tickWithoutBackgroundBuilder)
        .setValue(70)
    ticksRSI.push(tickRSIThresholdHigh)
}
//#endregion

//#region ----- Configure Axes -----
const charts = [chartOHLC, chartVolume, chartRSI]
const chartTitles = [chartOHLCTitle, chartVolumeTitle, chartRSITitle]
// Find lowest shown Chart index.
const lowestShownChartIndex = chartConfigs.reduce(
    (prev, chartConfig, i) => chartConfig.show ? i : prev,
    -1
)
// Find highest shown Chart index.
const highestShownChartIndex = chartConfigs.reduce(
    (prev, chartConfig, i) => chartConfig.show ? Math.min(i, prev) : prev,
    Number.MAX_SAFE_INTEGER
)
const masterAxis = charts[lowestShownChartIndex].getDefaultAxisX()

// Bind X Axes together.
const HandleScaleChangeX = (chartIndex: number) => {
    return (start: number, end: number) => {
        for (let i = 0; i < charts.length; i++) {
            if (chartConfigs[i].show) {
                const axis = charts[i].getDefaultAxisX()
                if (i !== chartIndex && (axis.getInterval().start !== start || axis.getInterval().end !== end))
                    axis.setInterval(start, end)
            }
        }
    }
}
for (let i = 0; i < charts.length; i++) {
    if (chartConfigs[i].show) {
        const chart = charts[i]
        chart.getDefaultAxisX()
            .setScrollStrategy(undefined)
            .onScaleChange(HandleScaleChangeX(i))
    }
}

// i !== j && axis.scale.getInnerStart() !== start && axis.scale.getInnerEnd() !== end

//#endregion

//#endregion

//#region ----- Implement logic for rendering supplied data -----
interface StringOHLCWithVolume {
    close: string
    high: string
    low: string
    open: string
    volume: string
}
/**
 * AppDataFormat is an object whose keys are UTC Dates as Strings.
 * 
 * Each value is an OHLC value with an additional 'volume'-field.
 * Note that at this stage values are strings, not numbers! To use with LCJS they must be parsed to Numbers.
 */
type AppDataFormat = { [key: string]: StringOHLCWithVolume }

const dateTimeTicks: CustomTick[] = []
let dataExists = false
const renderOHLCData = (name: string, data: OHLCDataFormat) => {
    dataExists = true
    //#region ----- Prepare data for rendering with LCJS -----
    // Map values to LCJS accepted format, with an additional X value.
    const xohlcValues: XOHLC[] = []
    // Separate Volume values from OHLC.
    const volumeValues: Point[] = []

    // Measure operation time.
    const tStart = window.performance.now()

    // Get starting Date from first item.
    const dataKeys = Object.keys(data)
    const dataKeysLen = dataKeys.length
    // Index data-values starting from X = 0.
    for (let x = 0; x < dataKeysLen; x++) {
        const key = dataKeys[x]
        const stringValues = data[key]
        const o = Number(stringValues.open)
        const h = Number(stringValues.high)
        const l = Number(stringValues.low)
        const c = Number(stringValues.close)
        const volume = Number(stringValues.volume)

        xohlcValues.push([x, o, h, l, c])
        volumeValues.push({ x, y: volume })
    }
    const xohlcValuesLen = xohlcValues.length
    const volumeValuesLen = volumeValues.length
    //#endregion 38

    // Define getDateFromIndex function.
    getDateFromIndex = (x) => {
        // Get Date directly from data.
        if (x in dataKeys)
            return new Date(dataKeys[x])
        else
            return undefined
    }
    // Set DateTimeFormatter.
    dateTimeFormatter = dataRange === DataRange.Month ?
        new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', minute: 'numeric', hour: 'numeric' }) :
        new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

    // Translate averagingFrameLengths to days.
    // Count amount of data-points per day (assumed to be roughly the same for each day).
    let firstDays = []
    let dataPointsPerDay: number
    for (let x = 0; x < dataKeysLen; x++) {
        const date = getDateFromIndex(x).getDate()
        if (firstDays.length === 0)
            firstDays[0] = { date, x }
        else {
            if (firstDays.length === 1) {
                if (date !== firstDays[0].date)
                    firstDays[1] = { date, x }
            } else {
                if (date !== firstDays[1].date) {
                    dataPointsPerDay = x - firstDays[1].x
                    break
                }
            }
        }
    }

    //#region ----- Render data -----
    const averagingFrameLength = dataRange === DataRange.Month ? 'averagingFrameLengthIntraday' : 'averagingFrameLength'

    //#region OHLC.
    if (seriesOHLC) {
        seriesOHLC
            .clear()
            .add(xohlcValues)
    }
    //#endregion

    //#region SMA.
    if (seriesSMA) {
        // Compute SMA values from XOHLC values using data-analysis library.
        const smaValues = simpleMovingAverage(xohlcValues, Math.round(chartConfigOHLC.sma[averagingFrameLength] * dataPointsPerDay))
        seriesSMA
            .clear()
            .add(smaValues)
    }
    //#endregion

    //#region EMA.
    if (seriesEMA) {
        // Compute EMA values from XOHLC values using data-analysis library.
        const emaValues = exponentialMovingAverage(xohlcValues, Math.round(chartConfigOHLC.sma[averagingFrameLength] * dataPointsPerDay))
        seriesEMA
            .clear()
            .add(emaValues)
    }
    //#endregion

    //#region Bollinger.
    if (seriesBollinger) {
        // Compute Bollinger bands points.
        const bollingerBandPoints = bollingerBands(xohlcValues, Math.round(chartConfigOHLC.bollinger[averagingFrameLength] * dataPointsPerDay))
        seriesBollinger
            .clear()
            .add(bollingerBandPoints)
    }
    //#endregion

    //#region Volume
    if (seriesVolume) {
        // To render Volume values as Histogram bars, map 'volumeValues' and add step values between data-points.
        const histogramBarValues: Point[] = []
        let prev: Point | undefined
        for (let i = 0; i < volumeValuesLen; i++) {
            const cur = volumeValues[i]
            // Add step between previous value and cur value.
            if (prev) {
                histogramBarValues.push({ x: prev.x, y: cur.y })
            }
            histogramBarValues.push(cur)
            prev = cur
        }

        seriesVolume
            .clear()
            .add(histogramBarValues)
    }
    //#endregion

    //#region RSI.

    //#endregion
    if (seriesRSI) {
        // Compute RSI values from XOHLC values using data-analysis library.
        const rsiValues = relativeStrengthIndex(xohlcValues, Math.round(chartConfigRSI[averagingFrameLength] * dataPointsPerDay))
        seriesRSI
            .clear()
            .add(rsiValues)
    }
    //#endregion
    console.log(`Prepared data in ${((window.performance.now() - tStart) / 1000).toFixed(1)} s`)
    console.log(`${xohlcValuesLen} XOHLC values, ${volumeValuesLen} Volume values.`)

    // Fit new data to view.
    masterAxis.fit(false)
    if (chartOHLC)
        chartOHLC.getDefaultAxisY().fit(true)
    if (chartVolume)
        chartVolume.getDefaultAxisY().fit(true)
    if (chartRSI)
        chartRSI.getDefaultAxisY().setInterval(0, 100)

    // Set title of OHLC Chart to show name data.
    if (chartOHLCTitle) {
        const dataRangeLabel = dataRange === DataRange.Month ?
            '1 month' : (dataRange === DataRange.Year ?
                '1 year' :
                '10 years'
            )
        chartOHLCTitle.setText(`${name} (${dataRangeLabel})`)
    }
    // Also set name of OHLC Series.
    if (seriesOHLC)
        seriesOHLC.setName(name)

    // ----- Add CustomTicks on to of default DateTime Ticks to indicate relevant dates -----
    for (const tick of dateTimeTicks)
        tick.dispose()
    dateTimeTicks.length = 0

    // Different Ticks based on data range.
    if (dataRange === DataRange.Month) {
        // Each day has its own tick.
        const dayFormatter = new Intl.DateTimeFormat(undefined, { day: '2-digit' })
        let prevDay: number | undefined
        for (let x = 0; x < dataKeysLen; x++) {
            const date = getDateFromIndex(x)
            const day = date.getDate()
            if (prevDay === undefined || day !== prevDay) {
                dateTimeTicks.push(masterAxis.addCustomTick(tickWithoutBackgroundBuilder)
                    .setValue(x)
                    // No gridlines.
                    .setGridStrokeLength(0)
                    // Custom formatting.
                    .setTextFormatter((x) => dayFormatter.format(getDateFromIndex(Math.round(x))))
                )
                prevDay = day
            }
        }
    } else if (dataRange === DataRange.Year) {
        // Each month has its own tick.
        const startOfMonthFormatter = new Intl.DateTimeFormat(undefined, { month: 'short' })
        let prevMonth: number | undefined
        for (let x = 0; x < dataKeysLen; x++) {
            const date = getDateFromIndex(x)
            const month = date.getMonth()
            if (prevMonth === undefined || month !== prevMonth) {
                dateTimeTicks.push(masterAxis.addCustomTick(tickWithoutBackgroundBuilder)
                    .setValue(x)
                    // No gridlines.
                    .setGridStrokeLength(0)
                    // Custom formatting.
                    .setTextFormatter((x) => startOfMonthFormatter.format(getDateFromIndex(Math.round(x))))
                )
                prevMonth = month
            }
        }
    } else if (dataRange === DataRange.TenYears) {
        // Each year has its own tick.
        const dayFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric' })
        let prevYear: number | undefined
        for (let x = 0; x < dataKeysLen; x++) {
            const date = getDateFromIndex(x)
            const year = date.getFullYear()
            if (prevYear === undefined || year !== prevYear) {
                dateTimeTicks.push(masterAxis.addCustomTick(tickWithoutBackgroundBuilder)
                    .setValue(x)
                    // No gridlines.
                    .setGridStrokeLength(0)
                    // Custom formatting.
                    .setTextFormatter((x) => dayFormatter.format(getDateFromIndex(Math.round(x))))
                )
                prevYear = year
            }
        }
    }
}

//#endregion

//#region ----- REST logic for fetching data -----

const maxAveragingFrameLength = Math.max(
    chartConfigOHLC.sma.averagingFrameLength,
    chartConfigOHLC.bollinger.averagingFrameLength,
    chartConfigRSI.averagingFrameLength
)

// Function that handles event where data search failed.
const dataSearchFailed = (searchSymbol: string) => {
    console.log('No data found for \'', searchSymbol, '\'')
    alert(`Data for '${searchSymbol}' not found. May be that:
1) Search symbol is not valid stock label.
2) Requested stock data is not available from data provider.
3) Data subscription limit has been reached for this day.
` )
}

const dataCaches: Map<string, DataCache> = new Map()

// Define function that searches OHLC data.
const searchData = () => {
    // Get search symbol from input field.
    const inputField = domElements.get(domElementIDs.dataSearchInput) as HTMLInputElement
    const searchSymbol = inputField.value

    // Form API parameters.
    /**
     * Symbol to search.
     */
    const symbol: string = searchSymbol
    // mode
    let mode: 'history' | 'intraday'

    switch (dataRange) {
        case DataRange.Month:
            mode = 'intraday'
            break
        case DataRange.Year:
        case DataRange.TenYears:
        default:
            mode = 'history'
    }

    let cached = dataCaches.get(symbol)

    if (!cached) {
        const cache = new DataCache(symbol, dataSource)
        dataCaches.set(symbol, cache)
        cached = cache
    }
    let dataPromise
    if (mode === 'history') {
        dataPromise = cached.getDailyData(dataRange)
    } else {
        dataPromise = cached.getIntraDayData()
    }
    dataPromise.then((data) => {
        renderOHLCData(`${searchSymbol} ${mode}`, data)
    })
        .catch((reason) => {
            dataSearchFailed(searchSymbol)
        })
}

// Subscribe to events where data-search is activated.
domElements.get(domElementIDs.dataSearchActivate)
    .addEventListener('click', searchData)

document
    .addEventListener('keydown', (event) => {
        const key = event.key
        if (key === 'Enter')
            searchData()
    })

    // Active data-search whenever data-search range is changed, and previous data was visible.
    ;[
        domElements.get(domElementIDs.dataSearchRange1),
        domElements.get(domElementIDs.dataSearchRange2),
        domElements.get(domElementIDs.dataSearchRange3)
    ].forEach((element) => element.addEventListener('change', () => {
        // Update data only if it was already rendered.
        if (dataExists) {
            searchData()
        }
    }))

//#endregion

//#endregion

//#region ----- Style application -----

//#region ----- Manage Colors and derived Styles using Enums and Maps.
enum AppColor {
    BackgroundPanel,
    BackgroundChart,
    Titles,
    Axes,
    Nibs,
    Labels,
    Ticks,
    CandlePositive,
    CandleNegative,
    SMA,
    EMA,
    VolumeFill,
    VolumeStroke,
    BollingerFill,
    BollingerStroke,
    LineRSI,
    HighRSI,
    LowRSI,
    AutoCursorFill,
    AutoCursorStroke
}
const colors = new Map<AppColor, Color>()

if (theme == Themes.light) {
    colors.set(AppColor.BackgroundPanel, ColorRGBA(255, 255, 255))
    colors.set(AppColor.BackgroundChart, ColorRGBA(252, 252, 252))
    colors.set(AppColor.Titles, ColorRGBA(0, 0, 0))
    colors.set(AppColor.Nibs, ColorRGBA(180, 180, 180))
    colors.set(AppColor.Labels, ColorRGBA(0, 0, 0))
    colors.set(AppColor.BollingerFill, ColorRGBA(150, 150, 150, 30))
    colors.set(AppColor.EMA, ColorRGBA(80, 120, 190))
    colors.set(AppColor.LineRSI, ColorRGBA(80, 120, 190))
    colors.set(AppColor.CandlePositive, ColorRGBA(18, 200, 50))
    colors.set(AppColor.SMA, ColorRGBA(255, 160, 0))
    colors.set(AppColor.VolumeFill, ColorRGBA(254, 160, 0))
    colors.set(AppColor.BollingerStroke, ColorRGBA(200, 200, 200))
} else {
    colors.set(AppColor.BackgroundPanel, ColorRGBA(32, 32, 32))
    colors.set(AppColor.BackgroundChart, ColorRGBA(24, 24, 24))
    colors.set(AppColor.Titles, ColorRGBA(241, 246, 242))
    colors.set(AppColor.Nibs, ColorRGBA(180, 180, 180))
    colors.set(AppColor.Labels, ColorRGBA(241, 246, 242))
    colors.set(AppColor.BollingerFill, ColorRGBA(255, 255, 255, 13))
    colors.set(AppColor.EMA, ColorRGBA(255, 255, 255))
    colors.set(AppColor.LineRSI, ColorRGBA(255, 255, 255))
    colors.set(AppColor.CandlePositive, ColorRGBA(28, 231, 69))
    colors.set(AppColor.SMA, ColorRGBA(254, 204, 0))
    colors.set(AppColor.VolumeFill, ColorRGBA(254, 204, 0))
    colors.set(AppColor.BollingerStroke, ColorRGBA(66, 66, 66))
}

colors.set(AppColor.Axes, ColorRGBA(150, 150, 150))
colors.set(AppColor.Ticks, colors.get(AppColor.Labels))
colors.set(AppColor.CandleNegative, ColorRGBA(219, 40, 68))
colors.set(AppColor.VolumeStroke, ColorRGBA(0, 0, 0, 0))
colors.set(AppColor.HighRSI, ColorRGBA(219, 40, 68))
colors.set(AppColor.LowRSI, ColorRGBA(28, 231, 69))
colors.set(AppColor.AutoCursorFill, colors.get(AppColor.BackgroundChart))
colors.set(AppColor.AutoCursorStroke, colors.get(AppColor.Ticks))
const solidFills = new Map<AppColor, SolidFill>()
colors.forEach((color, key) => solidFills.set(key, new SolidFill({ color })))

enum AppLineThickness { Thin, Thick }
const solidLines = new Map<AppColor, Map<AppLineThickness, SolidLine>>()
colors.forEach((_, key) => {
    const thicknessMap = new Map()
    thicknessMap.set(AppLineThickness.Thin, new SolidLine({ thickness: 2, fillStyle: solidFills.get(key) }))
    thicknessMap.set(AppLineThickness.Thick, new SolidLine({ thickness: 4, fillStyle: solidFills.get(key) }))
    solidLines.set(key, thicknessMap)
})

const fontSize = 12
//#endregion

// Style Dashboard.
// TODO: No API for styling Dashboard splitter color?

//#region ----- Style Charts -----
for (let i = 0; i < charts.length; i++) {
    const chart = charts[i]
    if (chart) {
        chart
            // No default titles.
            .setTitleFillStyle(emptyFill)
            .setTitleMarginTop(0)
            .setTitleMarginBottom(0)
            .setPadding({ top: 8, bottom: 8, left: 0 })
            // Color scheme.
            .setBackgroundFillStyle(solidFills.get(AppColor.BackgroundPanel))
            .setSeriesBackgroundFillStyle(solidFills.get(AppColor.BackgroundChart))
    }
}
// Add top padding to very first Chart, so nothing is hidden by data-search input.
charts[0].setPadding({ top: 20 })
// Remove bottom padding of very last Chart, to save space.
charts[charts.reduce((iMax, chart, i) => chart && i > iMax ? i : iMax, 0)].setPadding({ bottom: 0 })

for (const title of chartTitles)
    if (title)
        title
            .setTextFillStyle(solidFills.get(AppColor.Titles))
            .setTextFont((font) => font
                .setSize(fontSize)
                .setWeight('bold')
            )

// Push all charts left sides equal distance away from left border.
// TODO: Is there any way to do this without adding invisible custom ticks?
for (const chart of charts)
    if (chart)
        chart.getDefaultAxisY().addCustomTick()
            .setMarker((marker) => marker
                .setPointerLength(0)
                .setTextFillStyle(emptyFill)
                // Padding is used to control distance.
                // .setPadding({ left: 50 })
            )
            .setGridStrokeLength(0)
//#endregion

//#region ----- Style Axes -----
for (let i = 0; i < charts.length; i++) {
    const chart = charts[i]
    if (chart !== undefined) {
        const axisX = chart.getDefaultAxisX()
        const axisY = chart.getDefaultAxisY()
        const axes = [axisX, axisY]
        const isChartWithMasterAxis = axisX === masterAxis

        for (const axis of axes) {
            axis
                .setAnimationScroll(undefined)
                .setAnimationZoom(undefined)

            axis
                .setTickStyle<'Numeric'>(styler => styler
                    .setMajorTickStyle((tickStyle: VisibleTicks) => tickStyle
                        .setLabelFillStyle(solidFills.get(AppColor.Labels))
                        .setLabelFont((font) => font
                            .setSize(fontSize)
                        )
                        .setTickStyle(solidLines.get(AppColor.Ticks).get(AppLineThickness.Thin))
                    )
                    .setMinorTickStyle((tickStyle: VisibleTicks) => tickStyle
                        .setLabelFillStyle(solidFills.get(AppColor.Labels))
                        .setLabelFont((font) => font
                            .setSize(fontSize)
                        )
                        .setTickStyle(solidLines.get(AppColor.Ticks).get(AppLineThickness.Thin))
                    )
                )
            axis
                .setStrokeStyle(solidLines.get(AppColor.Axes).get(AppLineThickness.Thick))
                .setNibStyle(solidLines.get(AppColor.Nibs).get(AppLineThickness.Thick))
        }
        axisX
            .setTickStyle<'Numeric'>(styler => styler
                .setMajorTickStyle((tickStyle:VisibleTicks)=>tickStyle
                    .setLabelFont((f)=>f.setSize(0))
                    .setLabelPadding(0)
                    .setTickLength(0)
                )
                .setMinorTickStyle(emptyTick)
            )
        if (!isChartWithMasterAxis) {
            // This Charts X Axis is configured to scroll according to the master Axis.
            axisX
                // Disable scrolling.
                .setScrollStrategy(undefined)
                // Disable mouse interactions on hidden Axes.
                .setMouseInteractions(false)
                .setStrokeStyle(emptyLine)
                .setNibStyle(emptyLine)
        }
    }
}
for (const tick of ticksRSI)
    tick
        .setMarker((marker) => marker
            .setTextFillStyle(solidFills.get(AppColor.Ticks))
            .setTextFont((font) => font
                .setSize(fontSize)
            )
        )
// Style CustomTicks created when rendering.
tickWithoutBackgroundBuilder = tickWithoutBackgroundBuilder.addStyler((tick) => tick
    .setTextFillStyle(solidFills.get(AppColor.Labels))
    .setTextFont((font) => font
        .setSize(fontSize)
    )
)
//#endregion

//#region ----- Style Series -----
if (seriesOHLC)
    seriesOHLC
        .setPositiveStyle((candlestick) => candlestick
            .setBodyFillStyle(solidFills.get(AppColor.CandlePositive))
            .setStrokeStyle(solidLines.get(AppColor.CandlePositive).get(AppLineThickness.Thin))
        )
        .setNegativeStyle((candlestick) => candlestick
            .setBodyFillStyle(solidFills.get(AppColor.CandleNegative))
            .setStrokeStyle(solidLines.get(AppColor.CandleNegative).get(AppLineThickness.Thin))
        )
        .setFigureWidth(5)
        .setMouseInteractions(false)

if (seriesSMA)
    seriesSMA
        .setStrokeStyle(solidLines.get(AppColor.SMA).get(AppLineThickness.Thin))
        .setMouseInteractions(false)
if (seriesEMA)
    seriesEMA
        .setStrokeStyle(solidLines.get(AppColor.EMA).get(AppLineThickness.Thin))
        .setMouseInteractions(false)
if (seriesBollinger)
    seriesBollinger
        .setHighFillStyle(solidFills.get(AppColor.BollingerFill))
        .setLowFillStyle(solidFills.get(AppColor.BollingerFill))
        .setHighStrokeStyle(solidLines.get(AppColor.BollingerStroke).get(AppLineThickness.Thin))
        .setLowStrokeStyle(solidLines.get(AppColor.BollingerStroke).get(AppLineThickness.Thin))
        .setMouseInteractions(false)
if (seriesVolume)
    seriesVolume
        .setFillStyle(solidFills.get(AppColor.VolumeFill))
        .setStrokeStyle(solidLines.get(AppColor.VolumeStroke).get(AppLineThickness.Thin))
        .setMouseInteractions(false)
if (seriesRSI)
    seriesRSI
        .setStrokeStyle(solidLines.get(AppColor.LineRSI).get(AppLineThickness.Thin))
        .setMouseInteractions(false)

// Style RSI ticks.
if (tickRSIThresholdLow)
    tickRSIThresholdLow
        .setGridStrokeStyle(solidLines.get(AppColor.LowRSI).get(AppLineThickness.Thin))

if (tickRSIThresholdHigh)
    tickRSIThresholdHigh
        .setGridStrokeStyle(solidLines.get(AppColor.HighRSI).get(AppLineThickness.Thin))
//#endregion

//#region ----- Style ResultTables -----

const resultTableFormatter = ((tableContentBuilder, series, x, y) => tableContentBuilder
    .addRow(series.getName(), '', series.axisY.formatValue(y))
) as RangeSeriesFormatter & SeriesXYFormatter
if (seriesSMA)
    seriesSMA.setCursorResultTableFormatter(resultTableFormatter)
if (seriesEMA)
    seriesEMA.setCursorResultTableFormatter(resultTableFormatter)
if (seriesVolume)
    seriesVolume.setCursorResultTableFormatter(resultTableFormatter)
if (seriesRSI)
    seriesRSI.setCursorResultTableFormatter(resultTableFormatter)
if (seriesOHLC)
    seriesOHLC.setCursorResultTableFormatter((tableContentBuilder, series, ohlcSegment) => tableContentBuilder
        .addRow(series.getName())
        .addRow('Open', '', series.axisY.formatValue(ohlcSegment.getOpen()))
        .addRow('High', '', series.axisY.formatValue(ohlcSegment.getHigh()))
        .addRow('Low', '', series.axisY.formatValue(ohlcSegment.getLow()))
        .addRow('Close', '', series.axisY.formatValue(ohlcSegment.getClose()))
    )

// Enable AutoCursor auto coloring based on picked series.
const enableAutoCursorAutoColoring = (autoCursor: AutoCursorXY) => autoCursor
    .setResultTableAutoTextStyle(true)
    .setTickMarkerXAutoTextStyle(true)
    .setTickMarkerYAutoTextStyle(true)
// Style AutoCursors.
const styleAutoCursor = (autoCursor: AutoCursorXY) => autoCursor
    .setTickMarkerX((tickMarker: UIPointableTextBox) => tickMarker
        .setBackground((background) => background
            .setFillStyle(solidFills.get(AppColor.AutoCursorFill))
            .setStrokeStyle(solidLines.get(AppColor.AutoCursorStroke).get(AppLineThickness.Thin))
        )
    )
    .setTickMarkerY((tickMarker:UIPointableTextBox) => tickMarker
        .setBackground((background) => background
            .setFillStyle(solidFills.get(AppColor.AutoCursorFill))
            .setStrokeStyle(solidLines.get(AppColor.AutoCursorStroke).get(AppLineThickness.Thin))
        )

    )
    .setResultTable((resultTable) => resultTable
        .setBackground((background) => background
            .setFillStyle(solidFills.get(AppColor.AutoCursorFill))
            .setStrokeStyle(solidLines.get(AppColor.AutoCursorStroke).get(AppLineThickness.Thin))
        )
    )

if (chartOHLC)
    chartOHLC
        .setAutoCursor(enableAutoCursorAutoColoring)
        .setAutoCursor(styleAutoCursor)
if (chartVolume)
    chartVolume
        .setAutoCursor(enableAutoCursorAutoColoring)
        .setAutoCursor(styleAutoCursor)
if (chartRSI)
    chartRSI
        .setAutoCursor(enableAutoCursorAutoColoring)
        .setAutoCursor(styleAutoCursor)

if (seriesBollinger)
    // No Cursor picking for Bollinger Bands.
    seriesBollinger
        .setCursorEnabled(false)
//#endregion

//#endregion

// Render static data initially (1 year history of AAPL, taken on 26th September 2019).
// This is a temporary solution for while the API token is limited to an amount of searches.
const temporaryStaticData = require('./temporary-static-data.json')
renderOHLCData('AAPL history', temporaryStaticData)
