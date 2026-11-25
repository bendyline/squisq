# A Year at the Orchard Co-op

The Orchard Co-op is a group of forty family farms that sell apples, pears and cider together. This report looks back on the year: what we sold, where it went, and what we plan to change next season.

## Sales grew in every region

Sales rose by a third this year. The new cider line and two farmers' markets in the city did most of the work, and every region sold more than it did last year.

## Sales by region {[barChart slideLayout=feature]}

The north led every quarter.

| Region | Sales |
| ------ | ----- |
| North  | 420   |
| Valley | 310   |
| Coast  | 260   |
| City   | 190   |

## Where we sell

Our farms sit along the river valley, and our two new market stalls are in the city at its northern end.

## The valley {[map center="47.6,-122.3" zoom=9 mapStyle="road" slideLayout=feature]}

## Where the money went

Most of what we earned went back to the farms. The rest paid for the press, the trucks and the market stalls.

## Spending {[pieChart slideLayout=feature]}

| Use    | Share |
| ------ | ----- |
| Farms  | 62    |
| Press  | 14    |
| Trucks | 12    |
| Stalls | 8     |
| Other  | 4     |

## Spending by month {[columnChart slideLayout=feature]}

| Month | Spending |
| ----- | -------- |
| Jan   | 12       |
| Apr   | 18       |
| Jul   | 26       |
| Oct   | 41       |

## The harvest came early

A warm spring brought the harvest forward by two weeks. Pickers started in late August, and the press ran through October.

## Apples pressed {[lineChart slideLayout=feature]}

| Week   | Tonnes |
| ------ | ------ |
| Aug 25 | 4      |
| Sep 1  | 11     |
| Sep 8  | 19     |
| Sep 15 | 24     |
| Sep 22 | 21     |
| Sep 29 | 15     |
| Oct 6  | 8      |

## What our customers said

We asked two hundred customers about the year. Most of them would recommend the co-op to a friend.

## Customers at a glance {[layout slideLayout=feature]}

### {#card} {[rect x=160 y=200 width=1600 height=680 fill=#3b2a1e stroke=#e07a3a strokeWidth=6 borderRadius=36]}

### {#value} {[text x=240 y=290 width=1440 height=300 fontSize=200 fontWeight=bold align=center valign=middle]}

87%

### {#label} {[text x=240 y=620 width=1440 height=160 fontSize=64 align=center valign=middle]}

would recommend us to a friend

## Our best sellers

Three products made up most of the year's sales. Honeycrisp apples sold out first, and the dry cider found a following in the city.

## Best sellers {[dataTable slideLayout=feature]}

| Product           | Cases | Change |
| ----------------- | ----- | ------ |
| Honeycrisp apples | 1,840 | +22%   |
| Dry cider         | 1,210 | +61%   |
| Bartlett pears    | 760   | +4%    |

## How an order reaches a shop

An order now moves from the farm to the shop in two days instead of four. The co-op's new sorting shed is the reason.

## Order flow {[diagram slideLayout=feature]}

### Farm {connectsTo=shed}

### Sorting shed {connectsTo=truck}

### Truck {connectsTo=shop}

### Shop

## Who runs the co-op

A board of five growers runs the co-op. The manager reports to the board, and the press and the trucks report to the manager.

## Who reports to whom {[drawing slideLayout=feature]}

### Board {#board} {[rectangle x=140 y=20 width=160 height=70]}

### Manager {#manager} {[rectangle x=140 y=150 width=160 height=70]}

### Press {#press} {[rectangle x=20 y=280 width=160 height=70]}

### Trucks {#trucks} {[rectangle x=260 y=280 width=160 height=70]}

### {[line from=board to=manager]}

### {[line from=manager to=press]}

### {[line from=manager to=trucks]}

## The co-op's records

Every farm's records now live in one shared folder, organised by season and by farm, so anyone can find last year's numbers.

## Shared folder {[tree slideLayout=feature]}

- records/
  - 2025/
    - north-farms.csv
    - valley-farms.csv
  - 2026/
    - harvest.csv

## Next season

Next year we will open a third market stall and try a perry made from our own pears. The plan runs from the spring meeting to the autumn launch.

![The co-op's packing shed](/res/squisq.jpg)

## Next season's plan {[timeline slideLayout=feature]}

```timeline
Plan: ● Spring meeting {#meeting} ──────● Stall opens {#stall} ──────● Perry launch {#perry} ──────►
```

## Thank you

Thank you to every family, picker and customer who made this year possible.
